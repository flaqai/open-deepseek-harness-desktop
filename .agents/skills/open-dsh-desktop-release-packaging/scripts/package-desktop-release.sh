#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 [--version <version>] [--plan <path>] [--minimum-free-gib <gib>] [--retry-stage windows|macos|linux|download] [--reuse-run windows|macos|linux=<successful-run-id>] [--reuse-windows-candidate-run <completed-run-id>] [--replace-existing] [--restart] <owner/repo>" >&2
  exit 2
}

version=
plan_file=
minimum_free_gib=10
restart=0
retry_stage=
replace_existing=0
reuse_runs=()
windows_candidate_run_id=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      [[ $# -ge 2 ]] || usage
      version=$2
      shift 2
      ;;
    --plan)
      [[ $# -ge 2 ]] || usage
      plan_file=$2
      shift 2
      ;;
    --minimum-free-gib)
      [[ $# -ge 2 ]] || usage
      minimum_free_gib=$2
      shift 2
      ;;
    --restart)
      restart=1
      shift
      ;;
    --retry-stage)
      [[ $# -ge 2 ]] || usage
      retry_stage=$2
      shift 2
      ;;
    --reuse-run)
      [[ $# -ge 2 ]] || usage
      reuse_runs+=("$2")
      shift 2
      ;;
    --reuse-windows-candidate-run)
      [[ $# -ge 2 ]] || usage
      windows_candidate_run_id=$2
      shift 2
      ;;
    --replace-existing)
      replace_existing=1
      shift
      ;;
    --*) usage ;;
    *) break ;;
  esac
done
[[ $# -eq 1 ]] || usage
repository=$1
[[ "$minimum_free_gib" =~ ^[0-9]+$ ]] || usage
[[ -z "$retry_stage" || "$retry_stage" =~ ^(windows|macos|linux|download)$ ]] || usage
[[ -z "$windows_candidate_run_id" || "$windows_candidate_run_id" =~ ^[0-9]+$ ]] || usage
[[ "$restart" != 1 || -z "$retry_stage" ]] || { echo "--restart and --retry-stage are mutually exclusive" >&2; exit 2; }
if [[ -n "$windows_candidate_run_id" ]]; then
  for specification in ${reuse_runs[@]+"${reuse_runs[@]}"}; do
    [[ "$specification" != windows=* ]] || {
      echo "--reuse-windows-candidate-run cannot be combined with --reuse-run windows=..." >&2
      exit 2
    }
  done
fi

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repository_root=$(git rev-parse --show-toplevel)
common_git_directory=$(git rev-parse --path-format=absolute --git-common-dir)
branch=$(git branch --show-current)
source_sha=$(git rev-parse HEAD)
[[ -n "$branch" ]] || { echo "release packaging requires a named branch" >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "release packaging requires a clean checkout" >&2; exit 1; }

package_version=$(node -p "require(process.argv[1]).version" "$repository_root/apps/desktop/package.json")
if [[ -z "$version" ]]; then version=$package_version; fi
[[ "$version" == "$package_version" ]] || {
  echo "requested version $version does not match apps/desktop/package.json $package_version" >&2
  exit 1
}

state_directory="$common_git_directory/odsh-release-state"
state_file="$state_directory/$version.json"
state_tool="$script_directory/release-package-state.mjs"
plan_tool="$script_directory/release-plan.mjs"
if [[ -z "$plan_file" ]]; then
  plan_file="$state_directory/$version.plan.json"
fi
[[ -f "$plan_file" ]] || {
  echo "release packaging requires a release Doctor plan at $plan_file" >&2
  exit 1
}
node "$plan_tool" validate "$plan_file"
plan_get() {
  node "$plan_tool" get "$plan_file" "$1"
}
plan_set() {
  node "$plan_tool" set "$plan_file" "$@"
}
[[ "$(plan_get identity.version)" == "$version" ]] || { echo "release plan version does not match $version" >&2; exit 1; }
[[ "$(plan_get repositories.github)" == "$repository" ]] || { echo "release plan GitHub repository does not match $repository" >&2; exit 1; }
[[ "$(plan_get source.branch)" == "$branch" ]] || { echo "release plan source branch does not match $branch" >&2; exit 1; }
[[ "$(plan_get source.sha)" == "$source_sha" ]] || { echo "release plan source SHA does not match $source_sha" >&2; exit 1; }
[[ "$(plan_get notes.status)" == verified ]] || { echo "release plan requires verified bilingual notes" >&2; exit 1; }
[[ "$(plan_get network.status)" == verified ]] || { echo "release plan requires verified endpoint connectivity" >&2; exit 1; }
export ODSH_MIN_DOWNLOAD_MIBPS="$(plan_get network.minimumMibps)"
if [[ "$restart" == 1 && -f "$state_file" ]]; then
  mkdir -p "$state_directory"
  archived_state="$state_file.bak-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mv "$state_file" "$archived_state"
  echo "release orchestration: archived previous state at $archived_state"
fi
node "$state_tool" init "$state_file" "$version" "$repository" "$branch" "$source_sha"
if [[ -n "$retry_stage" ]]; then
  case "$retry_stage" in
    windows) retry_stages=(windows macos linux download) ;;
    macos) retry_stages=(macos download) ;;
    linux) retry_stages=(linux download) ;;
    download) retry_stages=(download) ;;
  esac
  node "$state_tool" retry "$state_file" "${retry_stages[@]}"
  for stage in "${retry_stages[@]}"; do
    if [[ "$stage" == download ]]; then
      plan_set artifacts.status pending
    else
      plan_set "platforms.$stage.status" pending
    fi
  done
  echo "release orchestration: retrying $retry_stage and its downstream stages"
fi

if [[ "${ODSH_RELEASE_TEST_OVERRIDES:-0}" == 1 ]]; then
  skip_remote_head_check=${ODSH_SKIP_REMOTE_HEAD_CHECK:-0}
  poll_seconds=${ODSH_RELEASE_POLL_SECONDS:-0}
else
  [[ -z "${ODSH_SKIP_REMOTE_HEAD_CHECK:-}" && -z "${ODSH_RELEASE_POLL_SECONDS:-}" ]] || {
    echo "release test overrides require ODSH_RELEASE_TEST_OVERRIDES=1" >&2
    exit 1
  }
  skip_remote_head_check=0
  poll_seconds=30
fi

source "$script_directory/configure-cli-proxy.sh"

if [[ "$skip_remote_head_check" != 1 ]]; then
  remote_sha=$(git ls-remote --heads origin "refs/heads/$branch" | awk 'NR == 1 { print $1 }')
  [[ "$remote_sha" == "$source_sha" ]] || {
    echo "origin/$branch is ${remote_sha:-missing}, but this checkout is $source_sha; push authorization is separate" >&2
    exit 1
  }
fi

available_kib=$(df -Pk "$repository_root" | awk 'NR == 2 { print $4 }')
required_kib=$((minimum_free_gib * 1024 * 1024))
if (( available_kib < required_kib )); then
  echo "release packaging needs at least ${minimum_free_gib} GiB free; only $((available_kib / 1024 / 1024)) GiB is available" >&2
  exit 1
fi

"$script_directory/check-release-endpoints.sh" "$repository"

state_get() {
  node "$state_tool" get "$state_file" "$1"
}

state_set() {
  node "$state_tool" set "$state_file" "$@"
}

gh_retry() {
  local attempt=1 delay=2 output error_file error_output
  while (( attempt <= 5 )); do
    error_file=$(mktemp)
    if output=$(gh "$@" 2>"$error_file"); then
      if [[ -s "$error_file" ]]; then cat "$error_file" >&2; fi
      rm -f "$error_file"
      printf '%s\n' "$output"
      return 0
    fi
    error_output=$(cat "$error_file")
    rm -f "$error_file"
    echo "release orchestration: gh attempt $attempt failed: $error_output" >&2
    (( attempt == 5 )) && return 1
    sleep "$delay"
    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done
}

dispatch_run() {
  local stage=$1 target=$2 refresh_plugins=$3 snapshot_run_id=${4:-} candidate_run_id=${5:-} run_id lookup_attempt retry_count
  retry_count=$(state_get "retries.$stage")
  retry_count=${retry_count:-0}
  local orchestration_id="odsh-${version}-${source_sha}-${stage}-r${retry_count}"
  local run_title="Desktop packages $target $orchestration_id"
  local args=(workflow run desktop-packages.yml --repo "$repository" --ref "$branch" -f "target=$target" -f "refresh_plugins=$refresh_plugins" -f "orchestration_id=$orchestration_id")
  if [[ -n "$snapshot_run_id" ]]; then
    args+=(-f "bundled_plugin_run_id=$snapshot_run_id")
  fi
  if [[ -n "$candidate_run_id" ]]; then
    args+=(-f "windows_candidate_run_id=$candidate_run_id")
  fi
  find_run() {
    gh_retry run list --repo "$repository" --workflow desktop-packages.yml --branch "$branch" \
      --event workflow_dispatch --limit 100 --json databaseId,headSha,displayTitle \
      --jq ".[] | select(.headSha == \"$source_sha\" and .displayTitle == \"$run_title\") | .databaseId" \
      | sed -n '1p'
  }
  run_id=$(find_run)
  if [[ -z "$run_id" ]]; then
    gh_retry "${args[@]}" >/dev/null
    lookup_attempt=1
    while [[ -z "$run_id" && "$lookup_attempt" -le 30 ]]; do
      sleep "$poll_seconds"
      run_id=$(find_run)
      lookup_attempt=$((lookup_attempt + 1))
    done
  fi
  [[ -n "$run_id" ]] || { echo "could not recover workflow run for orchestration key $orchestration_id" >&2; exit 1; }
  state_set "stages.$stage.runId" "$run_id" "stages.$stage.status" dispatched
  plan_set "platforms.$stage.runId" "$run_id" "platforms.$stage.sourceSha" "$source_sha" "platforms.$stage.status" running
  echo "release orchestration: dispatched $stage as run $run_id"
}

wait_run() {
  local stage=$1 run_id status conclusion head_sha url result
  run_id=$(state_get "stages.$stage.runId")
  [[ -n "$run_id" ]] || { echo "missing run ID for $stage" >&2; exit 1; }
  while true; do
    result=$(gh_retry run view "$run_id" --repo "$repository" --json status,conclusion,headSha,url --jq '[.status, (.conclusion // ""), .headSha, .url] | join("\u001f")')
    IFS=$'\x1f' read -r status conclusion head_sha url <<< "$result"
    node "$script_directory/check-release-platform-reuse.mjs" "$stage" "$head_sha" "$source_sha" >/dev/null || {
      state_set "stages.$stage.status" source-mismatch "stages.$stage.url" "$url"
      exit 1
    }
    state_set "stages.$stage.status" "$status" "stages.$stage.conclusion" "$conclusion" "stages.$stage.url" "$url"
    if [[ "$status" == completed ]]; then
      if [[ "$conclusion" != success ]]; then
        plan_set "platforms.$stage.status" failed "platforms.$stage.runId" "$run_id" "platforms.$stage.url" "$url"
        echo "$stage run $run_id concluded $conclusion: $url" >&2
        exit 1
      fi
      plan_set "platforms.$stage.status" succeeded "platforms.$stage.runId" "$run_id" \
        "platforms.$stage.sourceSha" "$head_sha" "platforms.$stage.url" "$url"
      state_set "stages.$stage.sourceSha" "$head_sha"
      echo "release orchestration: $stage run $run_id succeeded"
      return 0
    fi
    sleep "$poll_seconds"
  done
}

ensure_dispatched() {
  local stage=$1 target=$2 refresh_plugins=$3 snapshot_run_id=${4:-} candidate_run_id=${5:-} run_id
  run_id=$(state_get "stages.$stage.runId")
  if [[ -z "$run_id" ]]; then
    dispatch_run "$stage" "$target" "$refresh_plugins" "$snapshot_run_id" "$candidate_run_id"
  else
    echo "release orchestration: resuming $stage run $run_id"
  fi
}

reuse_run() {
  local specification=$1 stage=${1%%=*} run_id=${1#*=} existing result status conclusion head_sha url
  [[ "$stage" =~ ^(windows|macos|linux)$ && "$run_id" =~ ^[0-9]+$ ]] || usage
  existing=$(state_get "stages.$stage.runId")
  [[ -z "$existing" || "$existing" == "$run_id" ]] || {
    echo "release orchestration: $stage already has run $existing; use a stage retry before selecting another" >&2
    exit 1
  }
  result=$(gh_retry run view "$run_id" --repo "$repository" --json status,conclusion,headSha,url --jq '[.status, (.conclusion // ""), .headSha, .url] | join("\u001f")')
  IFS=$'\x1f' read -r status conclusion head_sha url <<< "$result"
  [[ "$status" == completed && "$conclusion" == success ]] || {
    echo "release orchestration: $stage run $run_id is not a successful completed run" >&2
    exit 1
  }
  node "$script_directory/check-release-platform-reuse.mjs" "$stage" "$head_sha" "$source_sha"
  state_set "stages.$stage.runId" "$run_id" "stages.$stage.status" completed \
    "stages.$stage.conclusion" success "stages.$stage.sourceSha" "$head_sha" "stages.$stage.url" "$url"
  plan_set "platforms.$stage.runId" "$run_id" "platforms.$stage.sourceSha" "$head_sha" \
    "platforms.$stage.status" succeeded "platforms.$stage.url" "$url"
}

for specification in ${reuse_runs[@]+"${reuse_runs[@]}"}; do reuse_run "$specification"; done

if [[ -n "$windows_candidate_run_id" ]]; then
  existing_windows_run=$(state_get stages.windows.runId)
  if [[ -z "$existing_windows_run" ]]; then
    candidate_result=$(gh_retry run view "$windows_candidate_run_id" --repo "$repository" --json status,conclusion,headSha,url --jq '[.status, (.conclusion // ""), .headSha, .url] | join("\u001f")')
    IFS=$'\x1f' read -r candidate_status candidate_conclusion candidate_sha candidate_url <<< "$candidate_result"
    [[ "$candidate_status" == completed ]] || {
      echo "Windows candidate run $windows_candidate_run_id has not completed: $candidate_url" >&2
      exit 1
    }
    git merge-base --is-ancestor "$candidate_sha" "$source_sha" || {
      echo "Windows candidate run $windows_candidate_run_id is not an ancestor of $source_sha" >&2
      exit 1
    }
    echo "release orchestration: requalifying completed Windows candidate from run $windows_candidate_run_id ($candidate_conclusion); CI will verify its content and installer hashes"
  fi
  ensure_dispatched windows windows-x64 false "$windows_candidate_run_id" "$windows_candidate_run_id"
else
  ensure_dispatched windows windows-x64 true
fi
wait_run windows
windows_run_id=$(state_get stages.windows.runId)
windows_source_sha=$(state_get stages.windows.sourceSha)

# Dispatch both remaining native targets before waiting so the runners overlap.
if [[ "$windows_source_sha" == "$source_sha" ]]; then
  ensure_dispatched macos macos false "$windows_run_id"
  ensure_dispatched linux linux-x64 false "$windows_run_id"
else
  # A cross-commit snapshot is not delegated to CI. Fresh runs resolve one and
  # the downloader requires its full content digest to match retained runs.
  ensure_dispatched macos macos true
  ensure_dispatched linux linux-x64 true
fi
wait_run macos
wait_run linux

macos_run_id=$(state_get stages.macos.runId)
linux_run_id=$(state_get stages.linux.runId)

if [[ "$common_git_directory" == */.git ]]; then
  primary_checkout=${common_git_directory%/.git}
else
  primary_checkout=$repository_root
fi
release_directory="$primary_checkout/release/$version"
download_status=$(state_get stages.download.status)
if [[ "$download_status" == verified ]]; then
  "$script_directory/verify-release-directory.sh" "$release_directory"
  echo "release orchestration: reused verified local artifacts"
else
  # A pre-existing directory can belong to an older set of successful runs.
  # Its SHA256SUMS cannot establish that the files came from the current run IDs.
  # Retry the identity-checked downloader instead of accepting that directory.
  state_set stages.download.status running
  if [[ "$replace_existing" == 1 || -n "$retry_stage" ]]; then
    "$script_directory/download-desktop-release.sh" --replace-existing --source-sha "$source_sha" "$repository" "$windows_run_id" "$macos_run_id" "$linux_run_id"
  else
    "$script_directory/download-desktop-release.sh" --source-sha "$source_sha" "$repository" "$windows_run_id" "$macos_run_id" "$linux_run_id"
  fi
  "$script_directory/verify-release-directory.sh" "$release_directory"
fi
state_set stages.download.status verified stages.download.directory "$release_directory"
plan_set artifacts.status verified artifacts.directory "$release_directory"
node "$plan_tool" render "$plan_file" "$state_directory/$version.md"

echo "release orchestration complete (not published)"
echo "  state: $state_file"
echo "  plan: $plan_file"
echo "  artifacts: $release_directory"
echo "  runs: windows=$windows_run_id macos=$macos_run_id linux=$linux_run_id"
