#!/usr/bin/env bash
set -euo pipefail

source_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
temporary=$(mktemp -d "${TMPDIR:-/tmp}/odsh-release-doctor-test.XXXXXX")
trap 'rm -rf "$temporary"' EXIT
fixture="$temporary/repository"
scripts="$fixture/.agents/skills/open-dsh-desktop-release-packaging/scripts"
mkdir -p "$scripts" "$fixture/apps/desktop" "$fixture/.github/workflows" \
  "$fixture/.artifacts/release-notes" "$temporary/bin"
cp "$source_directory/release-doctor.mjs" "$source_directory/release-plan.mjs" \
  "$source_directory/validate-release-notes.mjs" "$scripts/"
cat > "$scripts/check-release-endpoints.sh" <<'EOF'
#!/usr/bin/env bash
[[ ${ODSH_FIXTURE_ENDPOINT_FAIL:-0} != 1 ]] || exit 1
echo 'release endpoints: fixture routes are reachable via fixture-direct'
EOF
cat > "$scripts/check-release-download-speed.sh" <<'EOF'
#!/usr/bin/env bash
echo 'preparation must not run an artifact speed test' >&2
exit 75
EOF
chmod +x "$scripts"/*.mjs "$scripts"/*.sh
printf '{"version":"9.8.7"}\n' > "$fixture/apps/desktop/package.json"
printf '# Open DeepSeek Harness Desktop v9.8.7\n\n## 中文\n本版本完成了经过验证的桌面发行流程改进。\n\n## English\nThis release completes verified desktop delivery improvements.\n' > "$fixture/.artifacts/release-notes/odsh-v9.8.7.md"
cat > "$fixture/.github/workflows/desktop-packages.yml" <<'EOF'
name: fixture
on:
  workflow_dispatch:
    inputs:
      target:
      refresh_plugins:
      bundled_plugin_run_id:
      orchestration_id:
      windows_candidate_run_id:
permissions:
  contents: read
jobs: {}
EOF

cat > "$temporary/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  'release view') exit 1 ;;
  'release list') echo 'odsh-v9.8.6' ;;
  'variable get') echo true ;;
  'secret list') echo CNB_TOKEN ;;
  'workflow view') echo 'sync-cnb-desktop-releases' ;;
  *) echo "unexpected gh command: $*" >&2; exit 2 ;;
esac
EOF
chmod +x "$temporary/bin/gh"

git -C "$fixture" init -q
git -C "$fixture" config user.name fixture
git -C "$fixture" config user.email fixture@example.invalid
git -C "$fixture" add .
git -C "$fixture" commit -qm baseline
git -C "$fixture" tag odsh-v9.8.6
printf 'release delta\n' > "$fixture/release-delta.txt"
git -C "$fixture" add release-delta.txt
git -C "$fixture" commit -qm fixture
git -C "$fixture" branch -M release/9.8.7
git -C "$temporary" init -q --bare remote.git
git -C "$fixture" remote add origin "$temporary/remote.git"
git -C "$fixture" push -q -u origin release/9.8.7

output=$(cd "$fixture" && PATH="$temporary/bin:$PATH" ODSH_RELEASE_ROUTE_NAME=fixture-direct \
  node "$scripts/release-doctor.mjs" --minimum-free-gib 0 --minimum-mibps 1 fixture/desktop)
printf '%s\n' "$output"
printf '%s\n' "$output" | grep -q '| source:all-worktrees-reviewed | PASS | 1 clean worktree(s) |'
printf '%s\n' "$output" | grep -q '| network:release-endpoints | PASS | release endpoints:'
plan="$fixture/.git/odsh-release-state/9.8.7.plan.json"
node "$scripts/release-plan.mjs" validate "$plan"
[[ $(node "$scripts/release-plan.mjs" get "$plan" network.route) == fixture-direct ]]
[[ $(node "$scripts/release-plan.mjs" get "$plan" notes.status) == verified ]]
test -s "$fixture/.git/odsh-release-state/9.8.7.md"

printf 'dirty\n' > "$fixture/uncommitted.txt"
set +e
(cd "$fixture" && PATH="$temporary/bin:$PATH" node "$scripts/release-doctor.mjs" --minimum-free-gib 0 fixture/desktop) \
  >"$temporary/dirty.out" 2>&1
dirty_status=$?
set -e
[[ "$dirty_status" != 0 ]]
grep -q '| source:current-worktree-clean | FAIL |' "$temporary/dirty.out"
grep -q '| network:release-endpoints | SKIP |' "$temporary/dirty.out"

# Connectivity still blocks the Doctor; download speed does not.
rm "$fixture/uncommitted.txt"
before=$(shasum -a 256 "$plan")
set +e
(cd "$fixture" && PATH="$temporary/bin:$PATH" ODSH_FIXTURE_ENDPOINT_FAIL=1 \
  node "$scripts/release-doctor.mjs" --minimum-free-gib 0 fixture/desktop) >"$temporary/endpoints.out" 2>&1
endpoint_status=$?
set -e
[[ "$endpoint_status" != 0 ]]
grep -q '| network:release-endpoints | FAIL |' "$temporary/endpoints.out"
[[ $(shasum -a 256 "$plan") == "$before" ]]

echo 'release doctor fixture test passed'
