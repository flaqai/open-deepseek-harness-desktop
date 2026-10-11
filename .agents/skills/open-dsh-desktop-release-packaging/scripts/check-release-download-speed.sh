#!/usr/bin/env bash
set -euo pipefail

script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$script_directory/configure-cli-proxy.sh"
echo "release route: ${ODSH_RELEASE_ROUTE_NAME:-unknown}"

usage() {
  echo "usage: $0 <owner/repo> [--run-id <id>] [--artifact-name <name>] [--artifact-id <id>]" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
repository=$1
shift
run_id=
artifact_name=
artifact_id=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id) [[ $# -ge 2 ]] || usage; run_id=$2; shift 2 ;;
    --artifact-name) [[ $# -ge 2 ]] || usage; artifact_name=$2; shift 2 ;;
    --artifact-id) [[ $# -ge 2 ]] || usage; artifact_id=$2; shift 2 ;;
    *) usage ;;
  esac
done

for command_name in gh curl awk sed sort mktemp; do
  command -v "$command_name" >/dev/null || { echo "missing command: $command_name" >&2; exit 1; }
done

minimum_mibps=${ODSH_MIN_DOWNLOAD_MIBPS:-1.0}
sample_bytes=${ODSH_SPEED_TEST_BYTES:-33554432}
sample_seconds=${ODSH_SPEED_TEST_SECONDS:-15}
required_samples=${ODSH_SPEED_CHECK_SAMPLES:-2}
maximum_attempts=${ODSH_SPEED_CHECK_ATTEMPTS:-4}
retry_delay_seconds=${ODSH_SPEED_CHECK_RETRY_DELAY_SECONDS:-2}
awk -v value="$minimum_mibps" 'BEGIN { exit !(value >= 0) }' || {
  echo "ODSH_MIN_DOWNLOAD_MIBPS must be a non-negative number" >&2
  exit 2
}
[[ "$sample_bytes" =~ ^[1-9][0-9]*$ && "$sample_seconds" =~ ^[1-9][0-9]*$ ]] || {
  echo "speed-test byte and duration settings must be positive integers" >&2
  exit 2
}
[[ "$required_samples" =~ ^[1-9][0-9]*$ && "$maximum_attempts" =~ ^[1-9][0-9]*$ && "$retry_delay_seconds" =~ ^[0-9]+$ ]] || {
  echo "speed-check samples and attempts must be positive integers; retry delay must be non-negative" >&2
  exit 2
}
[[ "$maximum_attempts" -ge "$required_samples" ]] || {
  echo "ODSH_SPEED_CHECK_ATTEMPTS must be at least ODSH_SPEED_CHECK_SAMPLES" >&2
  exit 2
}

if awk -v value="$minimum_mibps" 'BEGIN { exit !(value == 0) }'; then
  echo "release download speed check disabled by ODSH_MIN_DOWNLOAD_MIBPS=0"
  exit 0
fi

temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/odsh-release-speed.XXXXXX")
auth_config="$temporary_directory/github-api.curlrc"
cleanup() { rm -rf "$temporary_directory"; }
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

if [[ -n "$artifact_id" ]]; then
  record=$(gh api "repos/$repository/actions/artifacts/$artifact_id" \
    --jq '[.name, (.id | tostring), (.size_in_bytes | tostring), (.expired | tostring), (.workflow_run.id | tostring), .created_at] | @tsv')
else
  if [[ -n "$run_id" ]]; then
    endpoint="repos/$repository/actions/runs/$run_id/artifacts?per_page=100"
  else
    endpoint="repos/$repository/actions/artifacts?per_page=100"
  fi
  records=$(gh api "$endpoint" --jq '.artifacts[] | select(.expired == false) | select(.name | test("^desktop-(windows-x64|macos-arm64|macos-x64|linux-x64)$")) | [.name, (.id | tostring), (.size_in_bytes | tostring), (.expired | tostring), (.workflow_run.id | tostring), .created_at] | @tsv')
  if [[ -n "$artifact_name" ]]; then
    records=$(printf '%s\n' "$records" | awk -F '\t' -v name="$artifact_name" '$1 == name')
  fi
  record=$(printf '%s\n' "$records" | sed '/^$/d' | sort -t $'\t' -k6,6r -k3,3nr | sed -n '1p')
fi

[[ -n "${record:-}" ]] || {
  echo "no non-expired desktop installer artifact is available for a release-node speed check" >&2
  exit 1
}
IFS=$'\t' read -r resolved_name resolved_id artifact_size expired resolved_run_id created_at <<< "$record"
[[ "$expired" == false ]] || { echo "artifact $resolved_id is expired" >&2; exit 1; }
if [[ -n "$artifact_name" && "$resolved_name" != "$artifact_name" ]]; then
  echo "artifact $resolved_id is named $resolved_name, expected $artifact_name" >&2
  exit 1
fi

range_end=$((sample_bytes - 1))
metrics_file="$temporary_directory/metrics"
header_file="$temporary_directory/artifact.headers"
samples_file="$temporary_directory/samples"
: > "$samples_file"
valid_samples=0
attempt=1
total_downloaded_bytes=0
total_elapsed_seconds=0
last_curl_status=0
last_http_code=unknown
while [[ "$valid_samples" -lt "$required_samples" && "$attempt" -le "$maximum_attempts" ]]; do
  rm -f "$header_file" "$metrics_file"
  set +e
  curl --silent --show-error --config "$auth_config" \
    --dump-header "$header_file" --output /dev/null \
    "https://api.github.com/repos/$repository/actions/artifacts/$resolved_id/zip"
  redirect_status=$?
  set -e
  signed_url=
  if [[ "$redirect_status" == 0 && -f "$header_file" ]]; then
    signed_url=$(awk 'tolower(substr($0, 1, 9)) == "location:" { sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); value=$0 } END { print value }' "$header_file")
  fi
  if [[ -z "$signed_url" ]]; then
    echo "release-node speed transport attempt $attempt/$maximum_attempts could not obtain a fresh signed URL (curl exit $redirect_status)" >&2
  else
    set +e
    curl --silent --location --range "0-$range_end" \
      --connect-timeout 10 --max-time "$sample_seconds" --output /dev/null \
      --write-out '%{size_download}\t%{time_total}\t%{speed_download}\t%{http_code}\n' \
      "$signed_url" > "$metrics_file"
    curl_status=$?
    set -e
    downloaded_bytes=0
    elapsed_seconds=0
    speed_bps=
    http_code=unknown
    [[ ! -s "$metrics_file" ]] || IFS=$'\t' read -r downloaded_bytes elapsed_seconds speed_bps http_code < "$metrics_file"
    last_curl_status=$curl_status
    last_http_code=$http_code
    if [[ -n "$speed_bps" && "$downloaded_bytes" != 0 \
      && ( "$http_code" == 200 || "$http_code" == 206 ) \
      && ( "$curl_status" == 0 || "$curl_status" == 28 ) ]]; then
      printf '%s\n' "$speed_bps" >> "$samples_file"
      valid_samples=$((valid_samples + 1))
      total_downloaded_bytes=$((total_downloaded_bytes + downloaded_bytes))
      total_elapsed_seconds=$(awk -v total="$total_elapsed_seconds" -v value="$elapsed_seconds" 'BEGIN { printf "%.6f", total + value }')
    else
      echo "release-node speed transport attempt $attempt/$maximum_attempts failed for $resolved_name (curl exit $curl_status, HTTP ${http_code:-unknown}); refreshing the signed URL" >&2
    fi
  fi
  attempt=$((attempt + 1))
  if [[ "$valid_samples" -lt "$required_samples" && "$attempt" -le "$maximum_attempts" && "$retry_delay_seconds" -gt 0 ]]; then
    sleep "$retry_delay_seconds"
  fi
done

if [[ "$valid_samples" -lt "$required_samples" ]]; then
  echo "release-node speed transport failed for $resolved_name after $maximum_attempts attempts ($valid_samples/$required_samples valid samples; last curl exit $last_curl_status, HTTP $last_http_code)" >&2
  exit 74
fi

minimum_speed_bps=$(LC_ALL=C sort -n "$samples_file" | sed -n '1p')
average_speed_bps=$(awk '{ total += $1 } END { printf "%.0f", total / NR }' "$samples_file")
speed_mibps=$(awk -v value="$minimum_speed_bps" 'BEGIN { printf "%.2f", value / 1048576 }')
average_mibps=$(awk -v value="$average_speed_bps" 'BEGIN { printf "%.2f", value / 1048576 }')
threshold_text=$(awk -v value="$minimum_mibps" 'BEGIN { printf "%.2f", value }')
printf 'release-node speed: %s MiB/s minimum, %s MiB/s average across %s samples (threshold %s MiB/s, artifact %s, run %s, sampled %s bytes in %.2fs)\n' \
  "$speed_mibps" "$average_mibps" "$valid_samples" "$threshold_text" "$resolved_name" "$resolved_run_id" "$total_downloaded_bytes" "$total_elapsed_seconds"

if awk -v speed="$minimum_speed_bps" -v minimum="$minimum_mibps" 'BEGIN { exit !(speed < minimum * 1048576) }'; then
  echo "release-node speed is below the configured threshold; pause download, preserve completed builds and resumable data, switch network/proxy/node, then retry" >&2
  exit 75
fi

echo "release-node speed check passed"
