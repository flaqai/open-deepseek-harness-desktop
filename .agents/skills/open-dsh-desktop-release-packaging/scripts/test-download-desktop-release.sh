#!/usr/bin/env bash
set -euo pipefail

script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repository_root=$(cd "$script_directory/../../../.." && pwd)
fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/odsh-download-test.XXXXXX")
cleanup() { chmod -R u+w "$fixture_root" 2>/dev/null || true; rm -rf "$fixture_root"; }
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

make_payload desktop-windows-x64 DeepSeek-Harness-windows-x64.exe DeepSeek-Harness-windows-x64.zip
make_payload desktop-macos-arm64 DeepSeek-Harness-macos-arm64.dmg DeepSeek-Harness-macos-arm64.zip
make_payload desktop-macos-x64 DeepSeek-Harness-macos-x64.dmg DeepSeek-Harness-macos-x64.zip
make_payload desktop-linux-x64 DeepSeek-Harness-linux-x64.deb DeepSeek-Harness-linux-x64.rpm
make_payload bundled-plugin-snapshot snapshot.json

checksum_payload="$fixture_root/payload-desktop-checksums"
mkdir -p "$checksum_payload"
for filename in \
  DeepSeek-Harness-windows-x64.exe DeepSeek-Harness-windows-x64.zip \
  DeepSeek-Harness-macos-arm64.dmg DeepSeek-Harness-macos-arm64.zip \
  DeepSeek-Harness-macos-x64.dmg DeepSeek-Harness-macos-x64.zip \
  DeepSeek-Harness-linux-x64.deb DeepSeek-Harness-linux-x64.rpm; do
  source_path=$(find "$fixture_root" -type f -name "$filename" | head -n 1)
  hash=$(shasum -a 256 "$source_path" | awk '{ print $1 }')
  checksum_name=$filename
  if [[ "$filename" == DeepSeek-Harness-windows-x64.exe ]]; then checksum_name="./$filename"; fi
  printf '%s  %s\n' "$hash" "$checksum_name" >> "$checksum_payload/SHA256SUMS"
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
  run_sha=fixture-sha
  if [[ -n ${ODSH_FIXTURE_OLD_SHA:-} ]]; then
    case "$3" in
      101|303) run_sha=$ODSH_FIXTURE_OLD_SHA ;;
      202) run_sha=$ODSH_FIXTURE_NEW_SHA ;;
    esac
  fi
  printf 'success\tfixture-branch\t%s\thttps://example.invalid/run/%s\n' "$run_sha" "$3"
  exit 0
fi
if [[ "$1" == api ]]; then
  artifact_id=$(printf '%s\n' "$*" | sed -n 's#.*actions/artifacts/\([^ /?]*\).*#\1#p')
  if [[ -n "$artifact_id" ]]; then
    for candidate in "$ODSH_FIXTURE_ARTIFACT_STORE"/*.zip; do
      for candidate_run_id in 101 202 303; do
        candidate_name=$(basename "$candidate" .zip)
        candidate_id=$(printf '%s' "$candidate_run_id-$candidate_name" | cksum | awk '{ print $1 }')
        if [[ "$candidate_id" == "$artifact_id" ]]; then
          size=$(wc -c < "$candidate" | tr -d ' ')
          printf '%s\t%s\t%s\tfalse\t%s\t2026-09-17T10:00:00Z\n' "$candidate_name" "$candidate_id" "$size" "$candidate_run_id"
          exit 0
        fi
      done
    done
    exit 1
  fi
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
metrics=0
output=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump-header) header_file=$2; shift 2 ;;
    --output) output=$2; shift 2 ;;
    --write-out) metrics=1; shift 2 ;;
    http*|fixture://*) url=$1; shift ;;
    *) shift ;;
  esac
done
if [[ "$metrics" == 1 ]]; then
  printf '8388608\t4.000000\t2097152\t206\n'
  exit 0
fi
if [[ "$url" == fixture://* && -z "$header_file" ]]; then
  name=${url#fixture://}
  [[ -z ${ODSH_FIXTURE_CURL_OUTPUT_LOG:-} ]] || printf '%s\n' "$output" >> "$ODSH_FIXTURE_CURL_OUTPUT_LOG"
  cp "$ODSH_FIXTURE_ARTIFACT_STORE/$name.zip" "$output"
  exit 0
fi
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
if [[ -n ${ODSH_FIXTURE_ARIA_ARGUMENTS:-} ]]; then printf '%s\n' "$*" >> "$ODSH_FIXTURE_ARIA_ARGUMENTS"; fi
if [[ -n ${ODSH_FIXTURE_ARIA_ENVIRONMENT:-} ]]; then
  printf 'ALL_PROXY=%s all_proxy=%s\n' "${ALL_PROXY:-}" "${all_proxy:-}" >> "$ODSH_FIXTURE_ARIA_ENVIRONMENT"
fi
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
if [[ -n "${ODSH_FIXTURE_ACTIVE_SPEED:-}" ]]; then
  printf 'partial\n' > "$directory/$output.aria2"
  trap 'exit 130' INT TERM
  for ((index = 0; index < 20; index += 1)); do
    printf '[#fixture 1MiB/10MiB(10%%) CN:1 DL:%s]\n' "$ODSH_FIXTURE_ACTIVE_SPEED" >&2
    sleep 0.2
  done
  exit 1
fi
if [[ -n "${ODSH_FIXTURE_FAIL_ONCE_FILE:-}" && ! -e "$ODSH_FIXTURE_FAIL_ONCE_FILE" ]]; then
  printf 'failed once\n' > "$ODSH_FIXTURE_FAIL_ONCE_FILE"
  size=$(wc -c < "$ODSH_FIXTURE_ARTIFACT_STORE/$name.zip" | tr -d ' ')
  partial_size=$((size / 2))
  dd if="$ODSH_FIXTURE_ARTIFACT_STORE/$name.zip" of="$directory/$output" bs=1 count="$partial_size" 2>/dev/null
  printf 'partial\n' > "$directory/$output.aria2"
  exit 1
fi
if [[ -n ${ODSH_FIXTURE_FAIL_COUNT_FILE:-} ]]; then
  failure_count=0
  [[ ! -f "$ODSH_FIXTURE_FAIL_COUNT_FILE" ]] || failure_count=$(cat "$ODSH_FIXTURE_FAIL_COUNT_FILE")
  if [[ "$failure_count" -lt ${ODSH_FIXTURE_FAIL_COUNT:-0} ]]; then
    printf '%s\n' "$((failure_count + 1))" > "$ODSH_FIXTURE_FAIL_COUNT_FILE"
    size=$(wc -c < "$ODSH_FIXTURE_ARTIFACT_STORE/$name.zip" | tr -d ' ')
    partial_size=$((size / 2))
    dd if="$ODSH_FIXTURE_ARTIFACT_STORE/$name.zip" of="$directory/$output" bs=1 count="$partial_size" 2>/dev/null
    printf 'partial\n' > "$directory/$output.aria2"
    exit 1
  fi
fi
cp "$ODSH_FIXTURE_ARTIFACT_STORE/$name.zip" "$directory/$output"
rm -f "$directory/$output.aria2"
EOF

chmod +x "$fake_bin/gh" "$fake_bin/curl" "$fake_bin/aria2c"
aria_arguments_log="$fixture_root/aria-arguments.log"
aria_environment_log="$fixture_root/aria-environment.log"

low_staging_root="$fixture_root/low-staging"
set +e
PATH="$fake_bin:$PATH" \
ODSH_FIXTURE_ARTIFACT_STORE="$artifact_store" \
ODSH_FIXTURE_ACTIVE_SPEED=256KiB \
ODSH_FIXTURE_ARIA_ARGUMENTS="$aria_arguments_log" \
ODSH_RELEASE_DOWNLOAD_STAGING_ROOT="$low_staging_root" \
ODSH_RELEASE_OUTPUT_DIRECTORY="$fixture_root/low-release" \
ODSH_ALLOW_RELEASE_OUTPUT_OVERRIDE=1 \
ODSH_SPEED_MONITOR_MIN_BYTES=1 \
ODSH_LOW_SPEED_WARMUP_SECONDS=0 \
ODSH_LOW_SPEED_WINDOW_SECONDS=1 \
ODSH_DOWNLOAD_URL_ATTEMPTS=1 \
ODSH_VERIFY_DMG=0 \
  "$script_directory/download-desktop-release.sh" fixture/repository 101 202 303
low_download_status=$?
set -e
[[ "$low_download_status" == 75 ]] || {
  echo "low active download exited $low_download_status, expected 75" >&2
  exit 1
}
find "$low_staging_root" -name '*.aria2' -type f | grep -q . || {
  echo "low-speed stop did not retain resumable state" >&2
  exit 1
}
echo "low-speed download fixture stopped with resumable state"

degraded_staging_root="$fixture_root/degraded-staging"
degraded_release_directory="$fixture_root/degraded-release"
degraded_failure_count="$fixture_root/degraded-failure-count"
curl_output_log="$fixture_root/curl-output.log"
ALL_PROXY=socks5h://127.0.0.1:7890 \
all_proxy=socks5h://127.0.0.1:7890 \
PATH="$fake_bin:$PATH" \
ODSH_FIXTURE_ARTIFACT_STORE="$artifact_store" \
ODSH_FIXTURE_FAIL_COUNT_FILE="$degraded_failure_count" \
ODSH_FIXTURE_FAIL_COUNT=3 \
ODSH_FIXTURE_ARIA_ARGUMENTS="$aria_arguments_log" \
ODSH_FIXTURE_ARIA_ENVIRONMENT="$aria_environment_log" \
ODSH_FIXTURE_CURL_OUTPUT_LOG="$curl_output_log" \
ODSH_RELEASE_DOWNLOAD_STAGING_ROOT="$degraded_staging_root" \
ODSH_RELEASE_OUTPUT_DIRECTORY="$degraded_release_directory" \
ODSH_ALLOW_RELEASE_OUTPUT_OVERRIDE=1 \
ODSH_SPEED_MONITOR_MIN_BYTES=999999999 \
ODSH_VERIFY_DMG=0 \
  "$script_directory/download-desktop-release.sh" fixture/repository 101 202 303
ODSH_VERIFY_DMG=0 "$script_directory/verify-release-directory.sh" "$degraded_release_directory"
grep -q -- '--max-connection-per-server=16' "$aria_arguments_log"
grep -q -- '--max-connection-per-server=4' "$aria_arguments_log" || {
  echo "download did not reduce aria2 concurrency after a transport failure" >&2
  exit 1
}
if grep -Eq 'ALL_PROXY=[^ ]|all_proxy=[^ ]' "$aria_environment_log"; then
  echo "aria2 inherited an incompatible all_proxy setting" >&2
  cat "$aria_environment_log" >&2
  exit 1
fi
grep -q '\.curl$' "$curl_output_log" || {
  echo "curl fallback reused the aria2 sparse output instead of an independent serial file" >&2
  exit 1
}
echo "transport failures reduced concurrency without leaking the SOCKS proxy to aria2"

fail_once_file="$fixture_root/failed-once"
if PATH="$fake_bin:$PATH" \
  ODSH_FIXTURE_ARTIFACT_STORE="$artifact_store" \
  ODSH_FIXTURE_FAIL_ONCE_FILE="$fail_once_file" \
  ODSH_FIXTURE_ARIA_ARGUMENTS="$aria_arguments_log" \
  ODSH_RELEASE_DOWNLOAD_STAGING_ROOT="$staging_root" \
  ODSH_RELEASE_OUTPUT_DIRECTORY="$release_directory" \
  ODSH_ALLOW_RELEASE_OUTPUT_OVERRIDE=1 \
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
ODSH_FIXTURE_ARIA_ARGUMENTS="$aria_arguments_log" \
ODSH_RELEASE_DOWNLOAD_STAGING_ROOT="$staging_root" \
ODSH_RELEASE_OUTPUT_DIRECTORY="$release_directory" \
ODSH_ALLOW_RELEASE_OUTPUT_OVERRIDE=1 \
ODSH_VERIFY_DMG=0 \
  "$script_directory/download-desktop-release.sh" fixture/repository 101 202 303

ODSH_VERIFY_DMG=0 "$script_directory/verify-release-directory.sh" "$release_directory"
grep -q -- '--summary-interval=10' "$aria_arguments_log"
[[ ! -d "$staging_root" || -z "$(find "$staging_root" -mindepth 1 -print -quit)" ]] || {
  echo "successful download did not clean its staging directory" >&2
  exit 1
}
echo "download-desktop-release fixture test passed"

chmod u+w "$release_directory"
touch "$release_directory/.DS_Store"
if ODSH_VERIFY_DMG=0 "$script_directory/verify-release-directory.sh" "$release_directory" >/dev/null 2>&1; then
  echo "exact handoff verification accepted .DS_Store" >&2
  exit 1
fi
rm "$release_directory/.DS_Store"
chmod a-w "$release_directory"

PATH="$fake_bin:$PATH" \
ODSH_FIXTURE_ARTIFACT_STORE="$artifact_store" \
ODSH_RELEASE_DOWNLOAD_STAGING_ROOT="$fixture_root/replacement-staging" \
ODSH_RELEASE_OUTPUT_DIRECTORY="$release_directory" \
ODSH_ALLOW_RELEASE_OUTPUT_OVERRIDE=1 \
ODSH_VERIFY_DMG=0 \
  "$script_directory/download-desktop-release.sh" --replace-existing fixture/repository 101 202 303
ODSH_VERIFY_DMG=0 "$script_directory/verify-release-directory.sh" "$release_directory"
[[ $(find "$(dirname "$release_directory")/.archive" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ') == 1 ]] || {
  echo "same-version replacement did not archive the previous handoff" >&2
  exit 1
}
echo "same-version replacement archived the previous exact handoff"

PATH="$fake_bin:$PATH" \
ODSH_FIXTURE_ARTIFACT_STORE="$artifact_store" \
ODSH_RELEASE_DOWNLOAD_STAGING_ROOT="$staging_root" \
ODSH_RELEASE_OUTPUT_DIRECTORY="$fixture_root/macos-only" \
ODSH_ALLOW_RELEASE_OUTPUT_OVERRIDE=1 \
ODSH_VERIFY_DMG=0 \
  "$script_directory/download-desktop-release.sh" --macos-only fixture/repository 202
ODSH_VERIFY_DMG=0 "$script_directory/verify-release-directory.sh" --macos-only "$fixture_root/macos-only"
if ODSH_VERIFY_DMG=0 "$script_directory/verify-release-directory.sh" "$fixture_root/macos-only"; then
  echo "partial macOS handoff must not pass the full release verifier" >&2
  exit 1
fi
echo "macOS-only download fixture test passed"

primary_checkout="$fixture_root/primary-checkout"
linked_checkout="$fixture_root/release-worktree"
mkdir -p "$primary_checkout/.agents/skills/open-dsh-desktop-release-packaging" "$primary_checkout/apps/desktop"
cp -R "$script_directory" "$primary_checkout/.agents/skills/open-dsh-desktop-release-packaging/"
printf '{"version":"%s"}\n' "$version" > "$primary_checkout/apps/desktop/package.json"
git -C "$primary_checkout" init -q
git -C "$primary_checkout" add .
git -C "$primary_checkout" -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm fixture
git -C "$primary_checkout" worktree add -q -b release-fixture "$linked_checkout"

PATH="$fake_bin:$PATH" \
ODSH_FIXTURE_ARTIFACT_STORE="$artifact_store" \
ODSH_RELEASE_DOWNLOAD_STAGING_ROOT="$fixture_root/linked-staging" \
ODSH_VERIFY_DMG=0 \
  "$linked_checkout/.agents/skills/open-dsh-desktop-release-packaging/scripts/download-desktop-release.sh" fixture/repository 101 202 303

canonical_release_directory="$primary_checkout/release/$version"
ODSH_VERIFY_DMG=0 "$script_directory/verify-release-directory.sh" "$canonical_release_directory"
[[ ! -e "$linked_checkout/release/$version" ]] || {
  echo "linked worktree incorrectly received the release handoff" >&2
  exit 1
}
echo "linked worktree download used the primary checkout release directory"

old_sha=$(git -C "$primary_checkout" rev-parse HEAD)
mkdir -p "$primary_checkout/apps/desktop/scripts"
printf 'macOS smoke fix\n' > "$primary_checkout/apps/desktop/scripts/smoke-macos-package.mjs"
git -C "$primary_checkout" add apps/desktop/scripts/smoke-macos-package.mjs
git -C "$primary_checkout" -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm 'macOS-only qualification fix'
new_sha=$(git -C "$primary_checkout" rev-parse HEAD)
(
  cd "$primary_checkout"
  PATH="$fake_bin:$PATH" \
  ODSH_FIXTURE_ARTIFACT_STORE="$artifact_store" \
  ODSH_FIXTURE_OLD_SHA="$old_sha" \
  ODSH_FIXTURE_NEW_SHA="$new_sha" \
  ODSH_RELEASE_DOWNLOAD_STAGING_ROOT="$fixture_root/mixed-staging" \
  ODSH_RELEASE_OUTPUT_DIRECTORY="$fixture_root/mixed-release" \
  ODSH_ALLOW_RELEASE_OUTPUT_OVERRIDE=1 \
  ODSH_VERIFY_DMG=0 \
    "$script_directory/download-desktop-release.sh" --source-sha "$new_sha" fixture/repository 101 202 303
)
ODSH_VERIFY_DMG=0 "$script_directory/verify-release-directory.sh" "$fixture_root/mixed-release"
echo "platform-compatible mixed-SHA handoff passed"
