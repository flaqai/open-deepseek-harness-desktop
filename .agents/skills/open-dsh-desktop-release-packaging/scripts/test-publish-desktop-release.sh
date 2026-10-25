#!/usr/bin/env bash
set -euo pipefail

script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
temporary=$(mktemp -d "${TMPDIR:-/tmp}/odsh-publish-test.XXXXXX")
cleanup() { rm -rf "$temporary"; }
trap cleanup EXIT

release_directory="$temporary/0.1.2-rc.9"
fake_bin="$temporary/bin"
mkdir -p "$release_directory" "$fake_bin"
installers=(
  DeepSeek-Harness-linux-x64.deb
  DeepSeek-Harness-linux-x64.rpm
  DeepSeek-Harness-macos-arm64.dmg
  DeepSeek-Harness-macos-arm64.zip
  DeepSeek-Harness-macos-x64.dmg
  DeepSeek-Harness-macos-x64.zip
  DeepSeek-Harness-windows-x64.exe
  DeepSeek-Harness-windows-x64.zip
)
for filename in "${installers[@]}"; do
  if [[ "$filename" == *.zip ]]; then
    mkdir -p "$temporary/zip-payload"
    printf 'fixture\n' > "$temporary/zip-payload/fixture.txt"
    (cd "$temporary/zip-payload" && zip -q "$release_directory/$filename" fixture.txt)
  else
    printf 'fixture for %s\n' "$filename" > "$release_directory/$filename"
  fi
done
for filename in "${installers[@]}"; do
  shasum -a 256 "$release_directory/$filename"
done | sed "s#$release_directory/##" > "$release_directory/SHA256SUMS"
notes_file="$temporary/notes.md"
printf '# 中文说明\n\n# English notes\n' > "$notes_file"

cat > "$fake_bin/gh" <<'FAKE_GH'
#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >> "$FAKE_GH_LOG"
printf '\n' >> "$FAKE_GH_LOG"
sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
tag=${FAKE_TAG:-odsh-v0.1.2-rc.9}
title=${FAKE_TITLE:-v0.1.2-rc.9}
prerelease=${FAKE_PRERELEASE:-false}
if [[ $1 == api && $2 == repos/test/repository/commits/$sha ]]; then echo "$sha"; exit 0; fi
if [[ $1 == api && $2 == repos/test/repository ]]; then exit 0; fi
if [[ $1 == api && $2 == repos/test/repository/releases/latest ]]; then echo "$tag"; exit 0; fi
if [[ $1 == api && $2 == repos/test/repository/git/ref/tags/$tag ]]; then
  [[ -f "$FAKE_GH_CREATED" || -f "$FAKE_GH_PUBLISHED" || ${FAKE_GH_EXISTING:-0} == 1 ]] || exit 1
  if [[ ${4:-} == .object.type ]]; then echo commit; else echo "$sha"; fi
  exit 0
fi
if [[ $1 == release && $2 == view ]]; then
  [[ -f "$FAKE_GH_CREATED" || -f "$FAKE_GH_PUBLISHED" || ${FAKE_GH_EXISTING:-0} == 1 ]] || exit 1
  if printf '%s\n' "$@" | grep -q assets; then
    for file in "$FAKE_ASSETS_DIRECTORY"/*; do
      [[ -f "$file" ]] || continue
      name=$(basename "$file")
      size=$(wc -c < "$file" | tr -d ' ')
      digest=$(shasum -a 256 "$file" | awk '{ print $1 }')
      if [[ ${FAKE_BAD_DIGEST:-0} == 1 && "$name" == DeepSeek-Harness-linux-x64.deb ]]; then
        digest=0000000000000000000000000000000000000000000000000000000000000000
      fi
      printf '%s\t%s\tsha256:%s\n' "$name" "$size" "$digest"
    done
  else
    draft=true
    [[ -f "$FAKE_GH_PUBLISHED" || ${FAKE_GH_EXISTING_DRAFT:-true} == false ]] && draft=false
    printf '%s\t%s\t%s\thttps://example.test/release\n' "$draft" "$prerelease" "$title"
  fi
  exit 0
fi
if [[ $1 == release && $2 == create ]]; then touch "$FAKE_GH_CREATED"; exit 0; fi
if [[ $1 == release && $2 == upload ]]; then
  file=$4
  [[ $(basename "$file") != ${FAKE_UPLOAD_FAIL_NAME:-} ]] || exit 1
  cp "$file" "$FAKE_ASSETS_DIRECTORY/"
  exit 0
fi
if [[ $1 == release && $2 == edit ]]; then touch "$FAKE_GH_PUBLISHED"; exit 0; fi
echo "unexpected fake gh invocation: $*" >&2
exit 1
FAKE_GH
chmod +x "$fake_bin/gh"

export PATH="$fake_bin:$PATH"
export FAKE_GH_LOG="$temporary/gh.log"
export FAKE_GH_CREATED="$temporary/created"
export FAKE_GH_PUBLISHED="$temporary/published"
export FAKE_ASSETS_DIRECTORY="$temporary/remote-assets"
export FAKE_RELEASE_DIRECTORY="$release_directory"
mkdir -p "$FAKE_ASSETS_DIRECTORY"
export ODSH_VERIFY_DMG=0
sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
common=(test/repository "$sha" odsh-v0.1.2-rc.9 "v0.1.2-rc.9" "$notes_file" "$release_directory")

"$script_directory/publish-desktop-release.sh" --release-state stable "${common[@]}" > "$temporary/dry-run.log"
[[ ! -e "$FAKE_GH_PUBLISHED" ]]
! grep -q 'release create' "$FAKE_GH_LOG"
grep -q 'no tag, asset, Draft, or Release was created or changed' "$temporary/dry-run.log"
grep -q 'release state: stable' "$temporary/dry-run.log"

: > "$FAKE_GH_LOG"
"$script_directory/publish-desktop-release.sh" --publish --release-state stable "${common[@]}" > "$temporary/publish.log"
grep -q 'release create' "$FAKE_GH_LOG"
[[ $(grep -c 'release upload' "$FAKE_GH_LOG") == 9 ]]
grep -q 'release edit' "$FAKE_GH_LOG"
grep -q -- '--latest' "$FAKE_GH_LOG"
! grep -q -- '--prerelease' "$FAKE_GH_LOG"
grep -q 'published verified Release' "$temporary/publish.log"

rm -f "$FAKE_GH_CREATED" "$FAKE_GH_PUBLISHED" "$FAKE_ASSETS_DIRECTORY"/*
: > "$FAKE_GH_LOG"
FAKE_PRERELEASE=true \
  "$script_directory/publish-desktop-release.sh" --publish --release-state prerelease \
  "${common[@]}" > "$temporary/prerelease.log"
grep -q -- '--prerelease' "$FAKE_GH_LOG"
grep -q -- '--latest=false' "$FAKE_GH_LOG"
grep -q 'release state: prerelease' "$temporary/prerelease.log"

stable_directory="$temporary/0.1.3"
cp -R "$release_directory" "$stable_directory"
rm -f "$FAKE_GH_CREATED" "$FAKE_GH_PUBLISHED" "$FAKE_ASSETS_DIRECTORY"/*
: > "$FAKE_GH_LOG"
FAKE_TAG=odsh-v0.1.3 \
FAKE_TITLE='v0.1.3' \
FAKE_PRERELEASE=false \
FAKE_RELEASE_DIRECTORY="$stable_directory" \
  "$script_directory/publish-desktop-release.sh" --publish --release-state stable \
  test/repository "$sha" odsh-v0.1.3 'v0.1.3' "$notes_file" "$stable_directory" > "$temporary/stable.log"
grep -q -- '--latest' "$FAKE_GH_LOG"
! grep -q -- '--prerelease' "$FAKE_GH_LOG"
grep -q 'published verified Release' "$temporary/stable.log"

rm -f "$FAKE_GH_PUBLISHED"
if "$script_directory/publish-desktop-release.sh" "${common[@]}" >/dev/null 2>&1; then
  echo "missing release state should have been rejected" >&2
  exit 1
fi

if FAKE_GH_EXISTING=1 FAKE_GH_EXISTING_DRAFT=false "$script_directory/publish-desktop-release.sh" \
  --release-state stable "${common[@]}" >/dev/null 2>&1; then
  echo "existing published Release should have been rejected" >&2
  exit 1
fi

if FAKE_GH_EXISTING=1 "$script_directory/publish-desktop-release.sh" \
  --release-state stable "${common[@]}" >/dev/null 2>&1; then
  echo "existing Draft without explicit resume should have been rejected" >&2
  exit 1
fi

rm -f "$FAKE_GH_CREATED" "$FAKE_GH_PUBLISHED" "$FAKE_ASSETS_DIRECTORY"/*
cp "$release_directory/DeepSeek-Harness-linux-x64.deb" "$FAKE_ASSETS_DIRECTORY/"
: > "$FAKE_GH_LOG"
FAKE_GH_EXISTING=1 "$script_directory/publish-desktop-release.sh" --publish --resume-draft \
  --release-state stable "${common[@]}" > "$temporary/resume.log"
[[ $(grep -c 'release upload' "$FAKE_GH_LOG") == 8 ]]
grep -q 'already uploaded with matching SHA-256 and size' "$temporary/resume.log"
grep -q 'published verified Release' "$temporary/resume.log"

rm -f "$FAKE_GH_CREATED" "$FAKE_GH_PUBLISHED" "$FAKE_ASSETS_DIRECTORY"/*
cp "$release_directory/DeepSeek-Harness-linux-x64.deb" "$FAKE_ASSETS_DIRECTORY/"
if FAKE_GH_EXISTING=1 FAKE_BAD_DIGEST=1 "$script_directory/publish-desktop-release.sh" \
  --publish --resume-draft --release-state stable "${common[@]}" >/dev/null 2>&1; then
  echo "remote digest mismatch should have been rejected without clobbering" >&2
  exit 1
fi
rm -f "$FAKE_GH_CREATED" "$FAKE_GH_PUBLISHED" "$FAKE_ASSETS_DIRECTORY"/*

mv "$release_directory/DeepSeek-Harness-linux-x64.rpm" "$temporary/missing.rpm"
if "$script_directory/publish-desktop-release.sh" --release-state stable "${common[@]}" >/dev/null 2>&1; then
  echo "missing asset should have been rejected" >&2
  exit 1
fi
mv "$temporary/missing.rpm" "$release_directory/DeepSeek-Harness-linux-x64.rpm"

printf 'extra\n' > "$release_directory/unexpected.txt"
if "$script_directory/publish-desktop-release.sh" --release-state stable "${common[@]}" >/dev/null 2>&1; then
  echo "extra asset should have been rejected" >&2
  exit 1
fi
rm "$release_directory/unexpected.txt"

cp "$release_directory/SHA256SUMS" "$temporary/checksums.good"
printf '0%.0s' {1..64} > "$release_directory/SHA256SUMS"
printf '  DeepSeek-Harness-linux-x64.deb\n' >> "$release_directory/SHA256SUMS"
if "$script_directory/publish-desktop-release.sh" --release-state stable "${common[@]}" >/dev/null 2>&1; then
  echo "invalid checksum set should have been rejected" >&2
  exit 1
fi
mv "$temporary/checksums.good" "$release_directory/SHA256SUMS"

if "$script_directory/publish-desktop-release.sh" --release-state stable \
  test/repository "$sha" odsh-v9.9.9 "v0.1.2-rc.9" "$notes_file" "$release_directory" >/dev/null 2>&1; then
  echo "mismatched tag should have been rejected" >&2
  exit 1
fi

echo "publish-desktop-release tests passed"
