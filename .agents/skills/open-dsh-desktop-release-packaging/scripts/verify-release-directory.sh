#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <release-directory>" >&2
  exit 2
}

macos_only=0
if [[ $# -eq 2 && $1 == --macos-only ]]; then
  macos_only=1
  shift
fi
[[ $# -eq 1 ]] || usage
directory=$1
installers=(
  DeepSeek-Harness-linux-x64.deb
  DeepSeek-Harness-linux-x64.rpm
  DeepSeek-Harness-macos-arm64.dmg
  DeepSeek-Harness-macos-arm64.zip
  DeepSeek-Harness-macos-x64.dmg
  DeepSeek-Harness-macos-x64.zip
  DeepSeek-Harness-windows-x64.exe
)
if [[ "$macos_only" == 1 ]]; then
  installers=(DeepSeek-Harness-macos-arm64.dmg DeepSeek-Harness-macos-arm64.zip DeepSeek-Harness-macos-x64.dmg DeepSeek-Harness-macos-x64.zip)
fi
expected=("${installers[@]}" SHA256SUMS)

[[ -d "$directory" ]] || { echo "release directory does not exist: $directory" >&2; exit 1; }

expected_listing=$(printf '%s\n' "${expected[@]}" | LC_ALL=C sort)
actual_listing=$(find "$directory" -mindepth 1 -maxdepth 1 -exec basename {} \; | LC_ALL=C sort)
if [[ "$actual_listing" != "$expected_listing" ]]; then
  echo "release directory must contain exactly ${#expected[@]} flat files" >&2
  echo "expected:" >&2
  printf '  %s\n' "${expected[@]}" >&2
  echo "actual:" >&2
  find "$directory" -mindepth 1 -maxdepth 1 -exec basename {} \; | LC_ALL=C sort | sed 's/^/  /' >&2
  exit 1
fi

for filename in "${expected[@]}"; do
  path="$directory/$filename"
  [[ -f "$path" && ! -L "$path" ]] || {
    echo "release entry is not a regular file: $path" >&2
    exit 1
  }
done

checksum_file="$directory/SHA256SUMS"
expected_checksum_names=$(printf '%s\n' "${installers[@]}" | LC_ALL=C sort)
actual_checksum_names=$(awk 'NF { name=$2; sub(/^\*/, "", name); print name }' "$checksum_file" | LC_ALL=C sort)
[[ "$actual_checksum_names" == "$expected_checksum_names" ]] || {
  echo "SHA256SUMS must contain exactly one entry for each installer" >&2
  exit 1
}

for filename in "${installers[@]}"; do
  path="$directory/$filename"
  expected_hash=$(awk -v name="$filename" '$2 == name || $2 == "*" name { print $1 }' "$checksum_file")
  [[ "$expected_hash" =~ ^[0-9a-fA-F]{64}$ ]] || {
    echo "invalid SHA-256 entry for $filename" >&2
    exit 1
  }
  actual_hash=$(shasum -a 256 "$path" | awk '{ print $1 }')
  [[ "$actual_hash" == "$expected_hash" ]] || {
    echo "SHA-256 mismatch for $filename" >&2
    exit 1
  }
  echo "$filename: SHA-256 OK"

  if [[ "$filename" == *.zip ]]; then
    unzip -tq "$path" >/dev/null
    echo "$filename: ZIP payload OK"
  fi

  if [[ "$filename" == *.dmg && $(uname -s) == Darwin && ${ODSH_VERIFY_DMG:-1} != 0 ]]; then
    hdiutil verify "$path" >/dev/null
    echo "$filename: DMG structure OK"
  fi
done

echo "release directory verified: $directory"
