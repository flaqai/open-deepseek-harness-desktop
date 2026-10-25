#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 [--replace-existing] [--source-sha <commit>] <owner/repo> <windows-run-id> <macos-run-id> <linux-run-id> | [--replace-existing] [--source-sha <commit>] --macos-only <owner/repo> <macos-run-id>" >&2
  exit 2
}

verify_args=()
replace_existing=0
source_sha=
while [[ ${1:-} == --* ]]; do
  case "$1" in
    --replace-existing) replace_existing=1; shift ;;
    --source-sha) [[ $# -ge 2 ]] || usage; source_sha=$2; shift 2 ;;
    --macos-only) break ;;
    *) usage ;;
  esac
done
if [[ $# -eq 3 && $1 == --macos-only ]]; then
  repository=$2
  run_ids=("$3")
  targets=(macos)
  verify_args=(--macos-only)
else
  [[ $# -eq 4 ]] || usage
  repository=$1
  run_ids=("$2" "$3" "$4")
  targets=(windows-x64 macos linux-x64)
fi
script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
reuse_checker="$script_directory/check-release-platform-reuse.mjs"
if [[ -n "$source_sha" ]]; then
  checkout_sha=$(git rev-parse HEAD)
  [[ "$source_sha" == "$checkout_sha" ]] || {
    echo "requested release source $source_sha does not match checkout $checkout_sha" >&2
    exit 1
  }
fi
source "$script_directory/configure-cli-proxy.sh"
repository_root=$(cd "$script_directory/../../../.." && pwd)
speed_check_script="$script_directory/check-release-download-speed.sh"
speed_monitor_script="$script_directory/monitor-release-download.mjs"

for command_name in gh git node shasum unzip curl; do
  command -v "$command_name" >/dev/null || { echo "missing command: $command_name" >&2; exit 1; }
done

version=$(node -p "require('$repository_root/apps/desktop/package.json').version")
if [[ -n ${ODSH_RELEASE_OUTPUT_DIRECTORY:-} ]]; then
  [[ ${ODSH_ALLOW_RELEASE_OUTPUT_OVERRIDE:-} == 1 ]] || {
    echo "ODSH_RELEASE_OUTPUT_DIRECTORY is reserved for fixture tests" >&2
    exit 1
  }
  output_directory=$ODSH_RELEASE_OUTPUT_DIRECTORY
else
  git_common_directory=$(git -C "$repository_root" rev-parse --path-format=absolute --git-common-dir)
  [[ $(basename "$git_common_directory") == .git && -d "$git_common_directory" ]] || {
    echo "cannot resolve the primary checkout from Git common directory: $git_common_directory" >&2
    exit 1
  }
  primary_checkout=$(dirname "$git_common_directory")
  output_directory="$primary_checkout/release/$version"
fi
[[ ! -e "$output_directory" || "$replace_existing" == 1 ]] || {
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

  connection_steps_text=${ODSH_DOWNLOAD_CONNECTION_STEPS:-16,4,2,1}
  previous_ifs=$IFS
  IFS=',' read -r -a connection_steps <<< "$connection_steps_text"
  IFS=$previous_ifs
  [[ ${#connection_steps[@]} -gt 0 ]] || {
    echo "ODSH_DOWNLOAD_CONNECTION_STEPS must contain at least one positive integer" >&2
    return 2
  }
  for connection_step in "${connection_steps[@]}"; do
    [[ "$connection_step" =~ ^[1-9][0-9]*$ ]] || {
      echo "ODSH_DOWNLOAD_CONNECTION_STEPS contains an invalid value: $connection_step" >&2
      return 2
    }
  done
  attempt=1
  max_attempts=${ODSH_DOWNLOAD_URL_ATTEMPTS:-${#connection_steps[@]}}
  [[ "$max_attempts" =~ ^[1-9][0-9]*$ ]] || {
    echo "ODSH_DOWNLOAD_URL_ATTEMPTS must be a positive integer" >&2
    return 2
  }
  minimum_mibps=${ODSH_MIN_DOWNLOAD_MIBPS:-1.0}
  monitor_minimum_bytes=${ODSH_SPEED_MONITOR_MIN_BYTES:-67108864}
  monitor_warmup_seconds=${ODSH_LOW_SPEED_WARMUP_SECONDS:-15}
  monitor_window_seconds=${ODSH_LOW_SPEED_WINDOW_SECONDS:-30}
  summary_interval_seconds=${ODSH_DOWNLOAD_SUMMARY_INTERVAL_SECONDS:-10}
  awk -v value="$minimum_mibps" 'BEGIN { exit !(value >= 0) }' || {
    echo "ODSH_MIN_DOWNLOAD_MIBPS must be a non-negative number" >&2
    return 2
  }
  [[ "$monitor_minimum_bytes" =~ ^[1-9][0-9]*$ ]] || {
    echo "ODSH_SPEED_MONITOR_MIN_BYTES must be a positive integer" >&2
    return 2
  }
  [[ "$monitor_warmup_seconds" =~ ^[0-9]+$ && "$monitor_window_seconds" =~ ^[1-9][0-9]*$ ]] || {
    echo "download speed warmup and window settings must be non-negative and positive integers" >&2
    return 2
  }
  [[ "$summary_interval_seconds" =~ ^[1-9][0-9]*$ ]] || {
    echo "ODSH_DOWNLOAD_SUMMARY_INTERVAL_SECONDS must be a positive integer" >&2
    return 2
  }
  speed_guard=0
  if [[ "$expected_size" -ge "$monitor_minimum_bytes" ]] && \
    awk -v value="$minimum_mibps" 'BEGIN { exit !(value > 0) }'; then
    speed_guard=1
  fi
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

    if [[ "$speed_guard" == 1 ]]; then
      "$speed_check_script" "$repository" --artifact-id "$artifact_id" --artifact-name "$artifact_name"
    fi
    signed_url=$(signed_artifact_url "$artifact_id")
    transfer_status=0
    connection_index=$((attempt - 1))
    if [[ "$connection_index" -ge ${#connection_steps[@]} ]]; then
      connection_index=$((${#connection_steps[@]} - 1))
    fi
    connections=${connection_steps[$connection_index]}
    use_serial_curl=0
    if [[ "$connections" == 1 && ${ODSH_DOWNLOAD_SERIAL_WITH_CURL:-1} != 0 ]]; then
      use_serial_curl=1
    fi
    if command -v aria2c >/dev/null && [[ "$use_serial_curl" == 0 ]]; then
      aria_arguments=(
        --continue=true
        --auto-file-renaming=false
        --allow-overwrite=true
        --max-connection-per-server="$connections"
        --split="$connections"
        --min-split-size=1M
        --download-result=hide
        --console-log-level=warn
        --summary-interval="$summary_interval_seconds"
        --dir="$archives_directory"
        --out="$(basename "$archive")"
        "$signed_url"
      )
      aria_command=(env -u ALL_PROXY -u all_proxy aria2c "${aria_arguments[@]}")
      if [[ "$speed_guard" == 1 ]]; then
        if node "$speed_monitor_script" \
          --minimum-mibps "$minimum_mibps" \
          --warmup-seconds "$monitor_warmup_seconds" \
          --window-seconds "$monitor_window_seconds" \
          -- "${aria_command[@]}"; then
          :
        else
          transfer_status=$?
        fi
      elif "${aria_command[@]}"; then
        :
      else
        transfer_status=$?
      fi
    else
      # aria2 may leave a preallocated sparse file populated by non-contiguous
      # ranges. curl can only resume a contiguous prefix, so keep an independent
      # serial transfer and replace the aria2 payload only after curl succeeds.
      serial_archive="$archive.curl"
      curl_arguments=(--fail --location --retry 3 --retry-delay 2 --continue-at - --output "$serial_archive")
      if [[ "$speed_guard" == 1 ]]; then
        minimum_bytes_per_second=$(awk -v value="$minimum_mibps" 'BEGIN { printf "%.0f", value * 1048576 }')
        curl_arguments+=(--speed-limit "$minimum_bytes_per_second" --speed-time "$monitor_window_seconds")
      fi
      if curl "${curl_arguments[@]}" "$signed_url"; then
        mv "$serial_archive" "$archive"
        rm -f "$archive.aria2"
        :
      else
        transfer_status=$?
      fi
    fi
    if [[ "$transfer_status" == 75 || ( "$speed_guard" == 1 && "$transfer_status" == 28 ) ]]; then
      echo "download stopped because speed remained below $minimum_mibps MiB/s; resumable data is preserved" >&2
      echo "switch network/proxy/node and retry, or ask the user to choose a different ODSH_MIN_DOWNLOAD_MIBPS value" >&2
      return 75
    fi
    if [[ "$transfer_status" != 0 ]]; then
      next_attempt=$((attempt + 1))
      if [[ "$next_attempt" -le "$max_attempts" ]]; then
        next_index=$((next_attempt - 1))
        if [[ "$next_index" -ge ${#connection_steps[@]} ]]; then
          next_index=$((${#connection_steps[@]} - 1))
        fi
        echo "artifact $artifact_name transport attempt $attempt/$max_attempts failed with status $transfer_status; refreshing its signed URL and retrying with ${connection_steps[$next_index]} connection(s)" >&2
      fi
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

for index in "${!run_ids[@]}"; do
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

  if [[ -n "$source_sha" ]]; then
    case "$target" in
      windows-x64) reuse_platform=windows ;;
      macos) reuse_platform=macos ;;
      linux-x64) reuse_platform=linux ;;
    esac
    node "$reuse_checker" "$reuse_platform" "$head_sha" "$source_sha"
    common_head_sha=$source_sha
  elif [[ -z "$common_head_sha" ]]; then
    common_head_sha=$head_sha
  elif [[ "$head_sha" != "$common_head_sha" ]]; then
    echo "workflow run $run_id uses $head_sha, expected $common_head_sha; pass --source-sha only after platform-impact review" >&2
    exit 1
  fi

  case "$target" in
    windows-x64)
      artifact_names=(desktop-windows-x64)
      expected=(DeepSeek-Harness-windows-x64.exe DeepSeek-Harness-windows-x64.zip)
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
    expected_hash=$(awk -v name="$filename" '$2 == name || $2 == "*" name || $2 == "./" name || $2 == "*./" name { print $1 }' "$checksum_file")
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
ODSH_VERIFY_DMG=${ODSH_VERIFY_DMG:-1} "$script_directory/verify-release-directory.sh" ${verify_args[@]+"${verify_args[@]}"} "$final_directory"

mkdir -p "$(dirname "$output_directory")"
if [[ -e "$output_directory" ]]; then
  chmod u+w "$output_directory"
  archive_root="$(dirname "$output_directory")/.archive"
  mkdir -p "$archive_root"
  archived_output="$archive_root/$version-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mv "$output_directory" "$archived_output"
  echo "archived previous release handoff at $archived_output"
fi
mv "$final_directory" "$output_directory"
chmod a-w "$output_directory"
completed=1
printf 'source SHA: %s\n' "$common_head_sha"
printf 'bundled-plugin snapshot: %s\n' "$common_snapshot_digest"
printf 'downloaded verified release files to %s\n' "$output_directory"
