#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <owner/repo> <windows-run-id> <macos-run-id> <linux-run-id>" >&2
  exit 2
}

[[ $# -eq 4 ]] || usage
repository=$1
run_ids=("$2" "$3" "$4")
targets=(windows-x64 macos linux-x64)
script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repository_root=$(cd "$script_directory/../../../.." && pwd)

for command_name in gh node shasum unzip curl; do
  command -v "$command_name" >/dev/null || { echo "missing command: $command_name" >&2; exit 1; }
done

version=$(node -p "require('$repository_root/apps/desktop/package.json').version")
output_directory=${ODSH_RELEASE_OUTPUT_DIRECTORY:-$repository_root/release/$version}
[[ ! -e "$output_directory" ]] || {
  echo "refusing to replace existing release directory: $output_directory" >&2
  exit 1
}

staging_root=${ODSH_RELEASE_DOWNLOAD_STAGING_ROOT:-${TMPDIR:-/tmp}/odsh-desktop-release-downloads}
staging_key=$(printf '%s\n' "$repository" "${run_ids[@]}" "$version" | shasum -a 256 | awk '{ print substr($1, 1, 16) }')
repository_key=$(printf '%s' "$repository" | tr '/:' '--' | tr -cd 'A-Za-z0-9._-')
staging="$staging_root/$repository_key-$version-$staging_key"
archives_directory="$staging/archives"
final_directory="$staging/final"
combined_checksums="$staging/combined-SHA256SUMS"
auth_config="$staging/github-api.curlrc"
completed=0

mkdir -p "$archives_directory"
rm -rf "$final_directory"
mkdir -p "$final_directory"

cleanup() {
  status=$?
  rm -f "$auth_config"
  if [[ "$completed" == 1 ]]; then
    rm -rf "$staging"
  elif [[ -d "$staging" ]]; then
    echo "download interrupted; resumable files retained in $staging" >&2
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

token=$(gh auth token)
previous_umask=$(umask)
umask 077
{
  printf 'header = "Authorization: Bearer %s"\n' "$token"
  printf 'header = "Accept: application/vnd.github+json"\n'
  printf 'header = "X-GitHub-Api-Version: 2022-11-28"\n'
} > "$auth_config"
umask "$previous_umask"
unset token

artifact_record() {
  run_id=$1
  artifact_name=$2
  records=$(gh api --paginate "repos/$repository/actions/runs/$run_id/artifacts?per_page=100" \
    --jq '.artifacts[] | [.name, (.id | tostring), (.size_in_bytes | tostring), (.expired | tostring)] | @tsv')
  matches=$(printf '%s\n' "$records" | awk -F '\t' -v name="$artifact_name" '$1 == name')
  match_count=$(printf '%s\n' "$matches" | sed '/^$/d' | wc -l | tr -d ' ')
  [[ "$match_count" == 1 ]] || {
    echo "workflow run $run_id has $match_count artifacts named $artifact_name" >&2
    return 1
  }
  printf '%s\n' "$matches"
}

signed_artifact_url() {
  artifact_id=$1
  header_file="$staging/artifact-$artifact_id.headers"
  rm -f "$header_file"
  curl --silent --show-error --config "$auth_config" \
    --dump-header "$header_file" --output /dev/null \
    "https://api.github.com/repos/$repository/actions/artifacts/$artifact_id/zip"
  location=$(awk 'tolower(substr($0, 1, 9)) == "location:" { sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); value=$0 } END { print value }' "$header_file")
  rm -f "$header_file"
  [[ -n "$location" ]] || {
    echo "GitHub did not return a signed URL for artifact $artifact_id" >&2
    return 1
  }
  printf '%s\n' "$location"
}

download_archive() {
  run_id=$1
  artifact_name=$2
  destination=$3
  record=$(artifact_record "$run_id" "$artifact_name")
  IFS=$'\t' read -r resolved_name artifact_id expected_size expired <<< "$record"
  [[ "$resolved_name" == "$artifact_name" && "$expired" == false ]] || {
    echo "artifact $artifact_name from run $run_id is expired or invalid" >&2
    return 1
  }

  archive="$archives_directory/$run_id-$artifact_id-$artifact_name.zip"
  if [[ -f "$archive" && ! -f "$archive.aria2" ]]; then
    actual_size=$(wc -c < "$archive" | tr -d ' ')
    if [[ "$actual_size" == "$expected_size" ]] && unzip -tq "$archive" >/dev/null 2>&1; then
      echo "reusing completed artifact $artifact_name ($actual_size bytes)"
    else
      echo "existing artifact $artifact_name is incomplete; resuming it"
    fi
  fi

  attempt=1
  max_attempts=${ODSH_DOWNLOAD_URL_ATTEMPTS:-3}
  while :; do
    actual_size=0
    [[ -f "$archive" ]] && actual_size=$(wc -c < "$archive" | tr -d ' ')
    if [[ "$actual_size" == "$expected_size" && ! -f "$archive.aria2" ]] && unzip -tq "$archive" >/dev/null 2>&1; then
      break
    fi
    [[ "$attempt" -le "$max_attempts" ]] || {
      echo "failed to download artifact $artifact_name after $max_attempts signed URLs" >&2
      return 1
    }

    signed_url=$(signed_artifact_url "$artifact_id")
    if command -v aria2c >/dev/null; then
      connections=${ODSH_DOWNLOAD_CONNECTIONS:-16}
      aria2c --continue=true --auto-file-renaming=false --allow-overwrite=true \
        --max-connection-per-server="$connections" --split="$connections" --min-split-size=1M \
        --download-result=hide --console-log-level=warn \
        --dir="$archives_directory" --out="$(basename "$archive")" "$signed_url" || true
    else
      curl --fail --location --retry 3 --retry-delay 2 --continue-at - \
        --output "$archive" "$signed_url" || true
    fi
    attempt=$((attempt + 1))
  done

  actual_size=$(wc -c < "$archive" | tr -d ' ')
  [[ "$actual_size" == "$expected_size" ]] || {
    echo "artifact $artifact_name has $actual_size bytes, expected $expected_size" >&2
    return 1
  }
  rm -rf "$destination"
  mkdir -p "$destination"
  unzip -oq "$archive" -d "$destination"
}

: > "$combined_checksums"
common_head_sha=
common_snapshot_digest=

for index in 0 1 2; do
  run_id=${run_ids[$index]}
  target=${targets[$index]}
  run_directory="$staging/$target"
  mkdir -p "$run_directory"

  metadata=$(gh run view "$run_id" -R "$repository" \
    --json conclusion,headBranch,headSha,url \
    --jq '[.conclusion, .headBranch, .headSha, .url] | @tsv')
  IFS=$'\t' read -r conclusion head_branch head_sha run_url <<< "$metadata"
  [[ "$conclusion" == success ]] || {
    echo "workflow run $run_id is not successful: ${conclusion:-unknown}" >&2
    exit 1
  }

  if [[ -z "$common_head_sha" ]]; then
    common_head_sha=$head_sha
  elif [[ "$head_sha" != "$common_head_sha" ]]; then
    echo "workflow run $run_id uses $head_sha, expected $common_head_sha" >&2
    exit 1
  fi

  case "$target" in
    windows-x64)
      artifact_names=(desktop-windows-x64)
      expected=(DeepSeek-Harness-windows-x64.exe)
      ;;
    macos)
      artifact_names=(desktop-macos-arm64 desktop-macos-x64)
      expected=(
        DeepSeek-Harness-macos-arm64.dmg
        DeepSeek-Harness-macos-arm64.zip
        DeepSeek-Harness-macos-x64.dmg
        DeepSeek-Harness-macos-x64.zip
      )
      ;;
    linux-x64)
      artifact_names=(desktop-linux-x64)
      expected=(DeepSeek-Harness-linux-x64.deb DeepSeek-Harness-linux-x64.rpm)
      ;;
  esac

  release_directory="$run_directory/release"
  checksums_directory="$run_directory/checksums"
  bundled_directory="$run_directory/bundled"
  for artifact_name in "${artifact_names[@]}"; do
    artifact_destination="$release_directory/$artifact_name"
    download_archive "$run_id" "$artifact_name" "$artifact_destination"
  done
  download_archive "$run_id" desktop-checksums "$checksums_directory"
  download_archive "$run_id" bundled-plugin-snapshot "$bundled_directory"

  snapshot_file_count=$(find "$bundled_directory" -type f | wc -l | tr -d ' ')
  [[ "$snapshot_file_count" -gt 0 ]] || {
    echo "workflow run $run_id has an empty bundled-plugin snapshot" >&2
    exit 1
  }
  snapshot_digest=$(
    cd "$bundled_directory"
    find . -type f -print | LC_ALL=C sort | while IFS= read -r file; do
      shasum -a 256 "$file"
    done | shasum -a 256 | awk '{ print $1 }'
  )
  if [[ -z "$common_snapshot_digest" ]]; then
    common_snapshot_digest=$snapshot_digest
  elif [[ "$snapshot_digest" != "$common_snapshot_digest" ]]; then
    echo "workflow run $run_id resolved a different bundled-plugin snapshot" >&2
    exit 1
  fi

  checksum_file="$checksums_directory/SHA256SUMS"
  [[ -f "$checksum_file" ]] || { echo "workflow run $run_id has no SHA256SUMS" >&2; exit 1; }
  for filename in "${expected[@]}"; do
    source_path=
    while IFS= read -r candidate; do
      [[ -z "$candidate" ]] || {
        [[ -z "$source_path" ]] || {
          echo "workflow run $run_id contains multiple files named $filename" >&2
          exit 1
        }
        source_path=$candidate
      }
    done <<EOF
$(find "$release_directory" -type f -name "$filename" -print)
EOF
    [[ -n "$source_path" && -f "$source_path" ]] || { echo "workflow run $run_id is missing $filename" >&2; exit 1; }
    expected_hash=$(awk -v name="$filename" '$2 == name || $2 == "*" name { print $1 }' "$checksum_file")
    [[ $(printf '%s\n' "$expected_hash" | sed '/^$/d' | wc -l | tr -d ' ') == 1 ]] || {
      echo "workflow checksum entry is missing or ambiguous for $filename" >&2
      exit 1
    }
    actual_hash=$(shasum -a 256 "$source_path" | awk '{ print $1 }')
    [[ "$actual_hash" == "$expected_hash" ]] || {
      echo "workflow checksum mismatch for $filename" >&2
      exit 1
    }
    cp -p "$source_path" "$final_directory/$filename"
    printf '%s  %s\n' "$expected_hash" "$filename" >> "$combined_checksums"
  done

  printf '%s run: %s (%s, %s)\n' "$target" "$run_url" "$head_branch" "$head_sha"
done

LC_ALL=C sort -k2,2 "$combined_checksums" > "$final_directory/SHA256SUMS"
ODSH_VERIFY_DMG=${ODSH_VERIFY_DMG:-1} "$script_directory/verify-release-directory.sh" "$final_directory"

mkdir -p "$(dirname "$output_directory")"
mv "$final_directory" "$output_directory"
completed=1
printf 'source SHA: %s\n' "$common_head_sha"
printf 'bundled-plugin snapshot: %s\n' "$common_snapshot_digest"
printf 'downloaded verified release files to %s\n' "$output_directory"
