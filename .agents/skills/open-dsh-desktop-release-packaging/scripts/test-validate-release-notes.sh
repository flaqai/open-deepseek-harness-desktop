#!/usr/bin/env bash
set -euo pipefail

script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
temporary=$(mktemp -d "${TMPDIR:-/tmp}/odsh-notes-test.XXXXXX")
trap 'rm -rf "$temporary"' EXIT

git -C "$temporary" init -q
git -C "$temporary" config user.name fixture
git -C "$temporary" config user.email fixture@example.invalid
printf 'old\n' > "$temporary/state.txt"
git -C "$temporary" add state.txt
git -C "$temporary" commit -qm old
git -C "$temporary" tag odsh-v1.2.2
printf 'new\n' >> "$temporary/state.txt"
git -C "$temporary" commit -qam new
sha=$(git -C "$temporary" rev-parse HEAD)
notes="$temporary/notes.md"
cat > "$notes" <<'EOF'
# Open DeepSeek Harness Desktop v1.2.3

## 中文

本版本改进了桌面打包和恢复流程，并提供经过校验的安装文件。

## English

This release improves desktop packaging and recovery with verified installers.
EOF

(cd "$temporary" && node "$script_directory/validate-release-notes.mjs" 1.2.3 odsh-v1.2.2 "$sha" "$notes")
git -C "$temporary" checkout -qb released-fix odsh-v1.2.2
printf 'release fix\n' > "$temporary/fix.txt"
git -C "$temporary" add fix.txt
git -C "$temporary" commit -qm 'released fix'
released_fix=$(git -C "$temporary" rev-parse HEAD)
git -C "$temporary" tag odsh-v1.2.2-fix
git -C "$temporary" checkout -qb integrated "$sha"
git -C "$temporary" cherry-pick "$released_fix" >/dev/null
git -C "$temporary" commit --amend -qm 'integrated equivalent fix'
integrated_sha=$(git -C "$temporary" rev-parse HEAD)
(cd "$temporary" && node "$script_directory/validate-release-notes.mjs" 1.2.3 odsh-v1.2.2-fix "$integrated_sha" "$notes")
if (cd "$temporary" && node "$script_directory/validate-release-notes.mjs" 1.2.3 odsh-v1.2.2-fix "$sha" "$notes" >/dev/null 2>&1); then
  echo 'missing release patch should have been rejected' >&2
  exit 1
fi
git -C "$temporary" checkout -qb released-merge odsh-v1.2.2
git -C "$temporary" merge --no-ff -qm 'release merge' released-fix
git -C "$temporary" tag odsh-v1.2.2-merge
if (cd "$temporary" && node "$script_directory/validate-release-notes.mjs" 1.2.3 odsh-v1.2.2-merge "$integrated_sha" "$notes" >/dev/null 2>&1); then
  echo 'release-only merge should have been rejected' >&2
  exit 1
fi
printf '\nTODO\n' >> "$notes"
if (cd "$temporary" && node "$script_directory/validate-release-notes.mjs" 1.2.3 odsh-v1.2.2 "$sha" "$notes" >/dev/null 2>&1); then
  echo 'placeholder notes should have been rejected' >&2
  exit 1
fi
echo 'validate-release-notes tests passed'
