#!/usr/bin/env bash
set -euo pipefail

source_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT

fixture="$temporary/repository"
scripts="$fixture/.agents/skills/open-dsh-desktop-release-packaging/scripts"
mkdir -p "$scripts" "$fixture/apps/desktop" "$temporary/bin"
cp "$source_directory/package-desktop-release.sh" "$scripts/"
cp "$source_directory/release-package-state.mjs" "$scripts/"
cp "$source_directory/release-plan.mjs" "$scripts/"
cp "$source_directory/check-release-platform-reuse.mjs" "$scripts/"

printf '{"version":"9.8.7"}\n' > "$fixture/apps/desktop/package.json"
printf 'name: fixture\n' > "$fixture/.github-workflow-placeholder"
printf 'release/\n' > "$fixture/.gitignore"
cat > "$scripts/configure-cli-proxy.sh" <<'EOF'
#!/usr/bin/env bash
:
EOF
cat > "$scripts/check-release-download-speed.sh" <<'EOF'
#!/usr/bin/env bash
echo "fixture speed passed"
EOF
cat > "$scripts/download-desktop-release.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$ODSH_FIXTURE_DOWNLOAD_LOG"
root=$(git rev-parse --show-toplevel)
if [[ -e "$root/release/9.8.7" ]]; then
  [[ "${1:-}" == --replace-existing ]] || { echo "fixture refuses existing release directory" >&2; exit 1; }
  rm -rf "$root/release/9.8.7"
fi
mkdir -p "$root/release/9.8.7"
EOF
cat > "$scripts/verify-release-directory.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ -d "$1" ]]
echo "$1" >> "$ODSH_FIXTURE_VERIFY_LOG"
EOF
chmod +x "$scripts"/*.sh

cat > "$temporary/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "run list" ]]; then
  case "$*" in
    *"windows-x64"*) target=windows-x64; id=${ODSH_FIXTURE_WINDOWS_RETRY_ID:-101} ;;
    *"macos"*) target=macos; id=202 ;;
    *"linux-x64"*) target=linux-x64; id=303 ;;
    *) exit 0 ;;
  esac
  grep -q "^dispatch $target $id " "$ODSH_FIXTURE_GH_LOG" 2>/dev/null && printf '%s\n' "$id"
  exit 0
elif [[ "$1 $2" == "workflow run" ]]; then
  target=
  refresh=
  snapshot=none
  candidate=none
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == -f ]]; then
      case "$2" in
        target=*) target=${2#target=} ;;
        refresh_plugins=*) refresh=${2#refresh_plugins=} ;;
        bundled_plugin_run_id=*) snapshot=${2#bundled_plugin_run_id=} ;;
        windows_candidate_run_id=*) candidate=${2#windows_candidate_run_id=} ;;
      esac
      shift 2
    else
      shift
    fi
  done
  case "$target" in
    windows-x64) id=${ODSH_FIXTURE_WINDOWS_RETRY_ID:-101} ;;
    macos) id=202 ;;
    linux-x64) id=303 ;;
    *) exit 2 ;;
  esac
  echo "dispatch $target $id refresh=$refresh snapshot=$snapshot candidate=$candidate" >> "$ODSH_FIXTURE_GH_LOG"
elif [[ "$1 $2" == "run view" ]]; then
  id=$3
  run_sha=$ODSH_FIXTURE_SHA
  if [[ -n ${ODSH_FIXTURE_OLD_RUN_SHA:-} && ( "$id" == 101 || "$id" == 303 ) ]]; then
    run_sha=$ODSH_FIXTURE_OLD_RUN_SHA
  fi
  echo "view $id" >> "$ODSH_FIXTURE_GH_LOG"
  count_file="$ODSH_FIXTURE_GH_LOG.view-$id"
  count=0
  [[ ! -f "$count_file" ]] || count=$(cat "$count_file")
  echo $((count + 1)) > "$count_file"
  if [[ "$count" == 0 ]]; then
    printf 'in_progress\x1f\x1f%s\x1fhttps://github.test/actions/runs/%s\n' "$run_sha" "$id"
  elif [[ "$id" == 101 && ${ODSH_FIXTURE_OLD_WINDOWS_FAILED:-0} == 1 ]]; then
    printf 'completed\x1ffailure\x1f%s\x1fhttps://github.test/actions/runs/%s\n' "$run_sha" "$id"
  else
    printf 'completed\x1fsuccess\x1f%s\x1fhttps://github.test/actions/runs/%s\n' "$run_sha" "$id"
  fi
else
  echo "unexpected gh invocation: $*" >&2
  exit 2
fi
EOF
chmod +x "$temporary/bin/gh"

git -C "$fixture" init -q
git -C "$fixture" config user.name fixture
git -C "$fixture" config user.email fixture@example.invalid
git -C "$fixture" add .
git -C "$fixture" commit -qm fixture
git -C "$fixture" branch -M release/9.8.7
sha=$(git -C "$fixture" rev-parse HEAD)
plan="$fixture/.git/odsh-release-state/9.8.7.plan.json"
node "$scripts/release-plan.mjs" init "$plan" 9.8.7 fixture/repository fixture/cnb \
  release/9.8.7 "$sha" odsh-v9.8.6 stable 1
node "$scripts/release-plan.mjs" set "$plan" notes.status verified network.status verified

export PATH="$temporary/bin:$PATH"
export ODSH_RELEASE_TEST_OVERRIDES=1
export ODSH_SKIP_REMOTE_HEAD_CHECK=1
export ODSH_RELEASE_POLL_SECONDS=0
export ODSH_FIXTURE_SHA=$sha
export ODSH_FIXTURE_GH_LOG="$temporary/gh.log"
export ODSH_FIXTURE_DOWNLOAD_LOG="$temporary/download.log"
export ODSH_FIXTURE_VERIFY_LOG="$temporary/verify.log"

(
  cd "$fixture"
  "$scripts/package-desktop-release.sh" --version 9.8.7 --minimum-free-gib 0 fixture/repository
)

expected=$'dispatch windows-x64 101 refresh=true snapshot=none candidate=none\nview 101\nview 101\ndispatch macos 202 refresh=false snapshot=101 candidate=none\ndispatch linux-x64 303 refresh=false snapshot=101 candidate=none\nview 202\nview 202\nview 303\nview 303'
[[ "$(cat "$ODSH_FIXTURE_GH_LOG")" == "$expected" ]] || {
  echo "unexpected orchestration order:" >&2
  cat "$ODSH_FIXTURE_GH_LOG" >&2
  exit 1
}
grep -q "^--source-sha $sha fixture/repository 101 202 303$" "$ODSH_FIXTURE_DOWNLOAD_LOG"
state="$fixture/.git/odsh-release-state/9.8.7.json"
node "$scripts/release-package-state.mjs" show "$state" | grep -q '"status": "verified"'
node "$scripts/release-plan.mjs" show "$plan" | grep -q '"status": "verified"'
[[ "$(node "$scripts/release-plan.mjs" get "$plan" platforms.windows.runId)" == 101 ]]

before=$(grep -c '^dispatch ' "$ODSH_FIXTURE_GH_LOG")
(
  cd "$fixture"
  "$scripts/package-desktop-release.sh" --version 9.8.7 --minimum-free-gib 0 fixture/repository
)
after=$(grep -c '^dispatch ' "$ODSH_FIXTURE_GH_LOG")
[[ "$before" == "$after" ]] || { echo "resume dispatched duplicate workflows" >&2; exit 1; }
[[ $(wc -l < "$ODSH_FIXTURE_DOWNLOAD_LOG" | tr -d ' ') == 1 ]] || { echo "resume repeated the completed download" >&2; exit 1; }

# A crash can leave download=running while an older, internally valid handoff
# still occupies the destination. Its hashes alone must not mark this run done.
node "$scripts/release-package-state.mjs" set "$state" stages.download.status running
printf 'old run\n' > "$fixture/release/9.8.7/stale-marker"
(
  cd "$fixture"
  "$scripts/package-desktop-release.sh" --version 9.8.7 --minimum-free-gib 0 --replace-existing fixture/repository
)
[[ $(wc -l < "$ODSH_FIXTURE_DOWNLOAD_LOG" | tr -d ' ') == 2 ]] || { echo "running download trusted a stale directory" >&2; exit 1; }
[[ ! -e "$fixture/release/9.8.7/stale-marker" ]] || { echo "stale release directory was retained" >&2; exit 1; }

# An explicit stage retry creates a new orchestration identity and clears downstream state.
rm -rf "$fixture/release/9.8.7"
(
  cd "$fixture"
  "$scripts/package-desktop-release.sh" --version 9.8.7 --minimum-free-gib 0 --retry-stage download fixture/repository
)
[[ $(wc -l < "$ODSH_FIXTURE_DOWNLOAD_LOG" | tr -d ' ') == 3 ]] || { echo "download retry did not repeat the transfer" >&2; exit 1; }
[[ "$(node "$scripts/release-package-state.mjs" get "$state" retries.download)" == 1 ]]

# A macOS-only qualification change retains successful Windows/Linux runs from
# the old commit while dispatching just the affected macOS target.
mkdir -p "$fixture/apps/desktop/scripts"
printf 'macOS smoke fix\n' > "$fixture/apps/desktop/scripts/smoke-macos-package.mjs"
git -C "$fixture" add apps/desktop/scripts/smoke-macos-package.mjs
git -C "$fixture" commit -qm 'fix macOS smoke only'
new_sha=$(git -C "$fixture" rev-parse HEAD)
mv "$plan" "$plan.previous"
node "$scripts/release-plan.mjs" init "$plan" 9.8.7 fixture/repository fixture/cnb \
  release/9.8.7 "$new_sha" odsh-v9.8.6 stable 1
node "$scripts/release-plan.mjs" set "$plan" notes.status verified network.status verified
rm -rf "$fixture/release/9.8.7"
: > "$ODSH_FIXTURE_GH_LOG"
export ODSH_FIXTURE_OLD_RUN_SHA=$sha
export ODSH_FIXTURE_SHA=$new_sha
(
  cd "$fixture"
  "$scripts/package-desktop-release.sh" --version 9.8.7 --minimum-free-gib 0 --restart \
    --reuse-run windows=101 --reuse-run linux=303 fixture/repository
)
[[ "$(grep '^dispatch ' "$ODSH_FIXTURE_GH_LOG")" == 'dispatch macos 202 refresh=true snapshot=none candidate=none' ]] || {
  echo 'platform-scoped retry dispatched an unaffected target' >&2
  cat "$ODSH_FIXTURE_GH_LOG" >&2
  exit 1
}
[[ "$(node "$scripts/release-plan.mjs" get "$plan" platforms.windows.sourceSha)" == "$sha" ]]
[[ "$(node "$scripts/release-plan.mjs" get "$plan" platforms.macos.sourceSha)" == "$new_sha" ]]
[[ "$(node "$scripts/release-plan.mjs" get "$plan" platforms.linux.sourceSha)" == "$sha" ]]

# A Windows smoke-only fix reruns qualification against the old candidate and
# its bundled-plugin snapshot. It must not dispatch a fresh installer build.
printf 'Windows smoke fix\n' > "$fixture/apps/desktop/scripts/smoke-windows-package.ps1"
git -C "$fixture" add apps/desktop/scripts/smoke-windows-package.ps1
git -C "$fixture" commit -qm 'fix Windows smoke only'
smoke_sha=$(git -C "$fixture" rev-parse HEAD)
mv "$plan" "$plan.previous"
node "$scripts/release-plan.mjs" init "$plan" 9.8.7 fixture/repository fixture/cnb \
  release/9.8.7 "$smoke_sha" odsh-v9.8.6 stable 1
node "$scripts/release-plan.mjs" set "$plan" notes.status verified network.status verified
rm -rf "$fixture/release/9.8.7"
: > "$ODSH_FIXTURE_GH_LOG"
export ODSH_FIXTURE_WINDOWS_RETRY_ID=404
export ODSH_FIXTURE_OLD_WINDOWS_FAILED=1
export ODSH_FIXTURE_SHA=$smoke_sha
(
  cd "$fixture"
  "$scripts/package-desktop-release.sh" --version 9.8.7 --minimum-free-gib 0 --restart \
    --reuse-windows-candidate-run 101 --reuse-run macos=202 --reuse-run linux=303 fixture/repository
)
[[ "$(grep '^dispatch ' "$ODSH_FIXTURE_GH_LOG")" == 'dispatch windows-x64 404 refresh=false snapshot=101 candidate=101' ]] || {
  echo 'Windows smoke-only retry rebuilt an unaffected installer' >&2
  cat "$ODSH_FIXTURE_GH_LOG" >&2
  exit 1
}
[[ "$(node "$scripts/release-plan.mjs" get "$plan" platforms.windows.sourceSha)" == "$smoke_sha" ]]

echo "package-desktop-release fixture test passed"
