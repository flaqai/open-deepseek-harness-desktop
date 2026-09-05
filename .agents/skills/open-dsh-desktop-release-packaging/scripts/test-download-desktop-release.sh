#!/usr/bin/env bash
set -euo pipefail

script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repository_root=$(cd "$script_directory/../../../.." && pwd)
fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/odsh-download-test.XXXXXX")
cleanup() { rm -rf "$fixture_root"; }
trap cleanup EXIT

for command_name in node shasum unzip zip; do
  command -v "$command_name" >/dev/null || { echo "missing command: $command_name" >&2; exit 1; }
done

fake_bin="$fixture_root/bin"
artifact_store="$fixture_root/artifacts"
staging_root="$fixture_root/staging"
mkdir -p "$fake_bin" "$artifact_store"

version=$(node -p "require('$repository_root/apps/desktop/package.json').version")
release_directory="$fixture_root/release/$version"

make_payload() {
  artifact_name=$1
  shift
  payload_directory="$fixture_root/payload-$artifact_name"
  mkdir -p "$payload_directory"
  for filename in "$@"; do
    if [[ "$filename" == *.zip ]]; then
      inner_directory="$fixture_root/inner-$filename"
      mkdir -p "$inner_directory"
      printf 'fixture\n' > "$inner_directory/file.txt"
      (cd "$inner_directory" && zip -q "$payload_directory/$filename" file.txt)
    else
      printf 'fixture %s\n' "$filename" > "$payload_directory/$filename"
    fi
  done
  (cd "$payload_directory" && zip -qr "$artifact_store/$artifact_name.zip" .)
}

make_payload desktop-windows-x64 DeepSeek-Harness-windows-x64.exe
make_payload desktop-macos-arm64 DeepSeek-Harness-macos-arm64.dmg DeepSeek-Harness-macos-arm64.zip
make_payload desktop-macos-x64 DeepSeek-Harness-macos-x64.dmg DeepSeek-Harness-macos-x64.zip
make_payload desktop-linux-x64 DeepSeek-Harness-linux-x64.deb DeepSeek-Harness-linux-x64.rpm
make_payload bundled-plugin-snapshot snapshot.json

checksum_payload="$fixture_root/payload-desktop-checksums"
mkdir -p "$checksum_payload"
for filename in \
  DeepSeek-Harness-windows-x64.exe \
  DeepSeek-Harness-macos-arm64.dmg DeepSeek-Harness-macos-arm64.zip \
  DeepSeek-Harness-macos-x64.dmg DeepSeek-Harness-macos-x64.zip \
  DeepSeek-Harness-linux-x64.deb DeepSeek-Harness-linux-x64.rpm; do
  source_path=$(find "$fixture_root" -type f -name "$filename" | head -n 1)
  hash=$(shasum -a 256 "$source_path" | awk '{ print $1 }')
  printf '%s  %s\n' "$hash" "$filename" >> "$checksum_payload/SHA256SUMS"
done
(cd "$checksum_payload" && zip -qr "$artifact_store/desktop-checksums.zip" .)

cat > "$fake_bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "auth token" ]]; then
  echo fixture-token
  exit 0
fi
if [[ "$1 $2" == "run view" ]]; then
  printf 'success\tfixture-branch\tfixture-sha\thttps://example.invalid/run/%s\n' "$3"
  exit 0
fi
if [[ "$1" == api ]]; then
  run_id=$(printf '%s\n' "$*" | sed -n 's#.*actions/runs/\([^/]*\)/artifacts.*#\1#p')
  for name in desktop-windows-x64 desktop-macos-arm64 desktop-macos-x64 desktop-linux-x64 desktop-checksums bundled-plugin-snapshot; do
    case "$run_id:$name" in
      101:desktop-windows-x64|101:desktop-checksums|101:bundled-plugin-snapshot|\
      202:desktop-macos-arm64|202:desktop-macos-x64|202:desktop-checksums|202:bundled-plugin-snapshot|\
      303:desktop-linux-x64|303:desktop-checksums|303:bundled-plugin-snapshot)
        path="$ODSH_FIXTURE_ARTIFACT_STORE/$name.zip"
        size=$(wc -c < "$path" | tr -d ' ')
        id=$(printf '%s' "$run_id-$name" | cksum | awk '{ print $1 }')
        printf '%s\t%s\t%s\tfalse\n' "$name" "$id" "$size"
        ;;
    esac
  done
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 1
EOF

cat > "$fake_bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
header_file=
url=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump-header) header_file=$2; shift 2 ;;
    http*) url=$1; shift ;;
    *) shift ;;
  esac
done
artifact_id=${url%/zip}
artifact_id=${artifact_id##*/}
name=
for candidate in "$ODSH_FIXTURE_ARTIFACT_STORE"/*.zip; do
  for run_id in 101 202 303; do
    candidate_name=$(basename "$candidate" .zip)
    candidate_id=$(printf '%s' "$run_id-$candidate_name" | cksum | awk '{ print $1 }')
    [[ "$candidate_id" != "$artifact_id" ]] || name=$candidate_name
  done
done
[[ -n "$name" ]] || exit 1
printf 'HTTP/1.1 302 Found\r\nLocation: fixture://%s\r\n\r\n' "$name" > "$header_file"
EOF

cat > "$fake_bin/aria2c" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
directory=
output=
url=
for argument in "$@"; do
  case "$argument" in
    --dir=*) directory=${argument#--dir=} ;;
    --out=*) output=${argument#--out=} ;;
    fixture://*) url=$argument ;;
  esac
done
name=${url#fixture://}
if [[ -n "${ODSH_FIXTURE_FAIL_ONCE_FILE:-}" && ! -e "$ODSH_FIXTURE_FAIL_ONCE_FILE" ]]; then
  printf 'failed once\n' > "$ODSH_FIXTURE_FAIL_ONCE_FILE"
  size=$(wc -c < "$ODSH_FIXTURE_ARTIFACT_STORE/$name.zip" | tr -d ' ')
  partial_size=$((size / 2))
  dd if="$ODSH_FIXTURE_ARTIFACT_STORE/$name.zip" of="$directory/$output" bs=1 count="$partial_size" 2>/dev/null
  printf 'partial\n' > "$directory/$output.aria2"
  exit 1
fi
cp "$ODSH_FIXTURE_ARTIFACT_STORE/$name.zip" "$directory/$output"
rm -f "$directory/$output.aria2"
EOF

chmod +x "$fake_bin/gh" "$fake_bin/curl" "$fake_bin/aria2c"

fail_once_file="$fixture_root/failed-once"
if PATH="$fake_bin:$PATH" \
  ODSH_FIXTURE_ARTIFACT_STORE="$artifact_store" \
  ODSH_FIXTURE_FAIL_ONCE_FILE="$fail_once_file" \
  ODSH_RELEASE_DOWNLOAD_STAGING_ROOT="$staging_root" \
  ODSH_RELEASE_OUTPUT_DIRECTORY="$release_directory" \
  ODSH_DOWNLOAD_URL_ATTEMPTS=1 \
  ODSH_VERIFY_DMG=0 \
    "$script_directory/download-desktop-release.sh" fixture/repository 101 202 303; then
  echo "expected first fixture download to fail" >&2
  exit 1
fi
find "$staging_root" -name '*.aria2' -type f | grep -q . || {
  echo "failed download did not retain resumable state" >&2
  exit 1
}

PATH="$fake_bin:$PATH" \
ODSH_FIXTURE_ARTIFACT_STORE="$artifact_store" \
ODSH_RELEASE_DOWNLOAD_STAGING_ROOT="$staging_root" \
ODSH_RELEASE_OUTPUT_DIRECTORY="$release_directory" \
ODSH_VERIFY_DMG=0 \
  "$script_directory/download-desktop-release.sh" fixture/repository 101 202 303

ODSH_VERIFY_DMG=0 "$script_directory/verify-release-directory.sh" "$release_directory"
[[ ! -d "$staging_root" || -z "$(find "$staging_root" -mindepth 1 -print -quit)" ]] || {
  echo "successful download did not clean its staging directory" >&2
  exit 1
}
echo "download-desktop-release fixture test passed"
