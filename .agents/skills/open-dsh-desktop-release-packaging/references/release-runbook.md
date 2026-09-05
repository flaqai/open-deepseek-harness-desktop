# Desktop release packaging runbook

## Scope

This runbook qualifies native desktop installers. The source of truth is the manually dispatched `.github/workflows/desktop-packages.yml`. Read `release-publication.md` only when the requested endpoint includes notes or a public Release.

## 1. Establish the release base

Inspect current state before switching branches:

```sh
git status --short --branch
git worktree list --porcelain
git branch -vv
git log --oneline --decorate -12
```

For every worktree with changes, determine whether the change is already merged, belongs to the requested release, or must remain isolated. Do not move dirty files between worktrees as a shortcut.

Fetch the remote when current remote state matters. Confirm the exact commit intended for the release. If the user requests the latest `master`, do not silently use a local branch that is behind or has unrelated commits.

## 2. Prepare branches and version

The established names are:

```text
release/<version>
fix/windows-packaging-<version>
```

The desktop installer version is owned by `apps/desktop/package.json`. Verify the current repository before editing; do not assume the root package version must match. Keep the release branch as the final package source. Use the fix branch for packaging investigation and retries, then merge or fast-forward the accepted fix into the release branch when the user requests that target layout.

Before pushing, run the checks selected by the changed surface. For ordinary release preparation, use focused tests, strict TypeScript or desktop build checks, documentation gates when documentation changed, and `git diff --check`. Do not repeat already-passing unrelated suites merely because a commit was created.

## 3. Dispatch native builds

Use the final packaging branch and keep publication disabled:

```sh
gh workflow run desktop-packages.yml \
  --ref <branch> \
  -f target=windows-x64 \
  -f publish=false
```

Find the new run and verify its `headSha` equals the intended commit:

```sh
gh run list \
  --workflow desktop-packages.yml \
  --branch <branch> \
  --event workflow_dispatch \
  --limit 5 \
  --json databaseId,headSha,status,conclusion,url,createdAt
```

Then monitor it:

```sh
gh run watch <run-id> --exit-status
```

Repeat for `macos`, then `linux-x64`. The accepted jobs are:

- bundled plugin resolution;
- native package build;
- Windows installed-package smoke test for Windows;
- SHA-256 checksum generation;
- artifact upload.

If a run fails:

```sh
gh run view <run-id> --log-failed
```

Fix the actual failure on the packaging-fix branch. After any source commit changes, previous platform artifacts are stale even if their earlier run was green.

## 4. Bundled plugin consistency

Each workflow run resolves registry-backed entries at their current stable version and passes one offline snapshot to that run's native builders. Separate Windows, macOS, and Linux runs can resolve different snapshots if a plugin publishes between runs.

The download helper computes one complete content digest for each run's `bundled-plugin-snapshot` artifact in temporary storage. The three digests must match. If they differ, do not combine those artifacts into one release. Re-run the stale targets close together, or use one `target=all` run when a single shared snapshot is more important than staged platform diagnosis.

## 5. Download one flat release set

After Windows, macOS, and Linux have successful runs, pass all three run IDs to one helper. It derives the version from `apps/desktop/package.json`, verifies the runs in temporary storage, and atomically creates the ignored `release/<version>/` directory:

```sh
skill=.agents/skills/open-dsh-desktop-release-packaging

"$skill/scripts/download-desktop-release.sh" \
  flaqai/open-deepseek-harness-desktop \
  <windows-run-id> \
  <macos-run-id> \
  <linux-run-id>
```

The resulting directory is flat and contains exactly these eight files:

```text
DeepSeek-Harness-linux-x64.deb
DeepSeek-Harness-linux-x64.rpm
DeepSeek-Harness-macos-arm64.dmg
DeepSeek-Harness-macos-arm64.zip
DeepSeek-Harness-macos-x64.dmg
DeepSeek-Harness-macos-x64.zip
DeepSeek-Harness-windows-x64.exe
SHA256SUMS
```

GitHub displays ten Release assets because it adds `Source code (zip)` and `Source code (tar.gz)` automatically. Those generated archives are not files in the local handoff directory and are not uploaded by this workflow.

The helper requires all three runs to name the same source commit and bundled-plugin snapshot. It validates each run conclusion, exact artifact ID, expected filename, and workflow checksum; validates ZIP payloads and optionally DMGs on macOS; combines the seven checksum entries; and refuses to replace an existing release directory.

Downloads use a stable directory below the system temporary directory, keyed by repository, run IDs, and version. When `aria2c` is present, each archive uses 16 parallel ranges by default; otherwise `curl` resumes serially. A failed run retains the staging directory, and a retry refreshes the signed URL while continuing the same artifact ID. Completed archives are reused only when both the API-reported size and ZIP integrity match. Extraction is always non-interactive. A successful atomic handoff removes its staging directory.

Do not delete a retained staging directory just to retry, and do not introduce a one-off download script for large artifacts. Never rename unknown temporary files by process ID, file size, or download order. Never resume one artifact with another artifact's URL. If intentional cleanup is needed later, use the exact retained path printed by the helper after confirming that no retry needs it.

## 6. Final verification

Run the exact-set check again:

```sh
"$skill/scripts/verify-release-directory.sh" "$PWD/release/<version>"
```

The verifier requires exactly seven installers and one checksum file at the directory root. Any nested directory, workflow metadata, bundled-plugin snapshot, source archive, partial download, or unrelated file makes verification fail. Artifact-container ZIPs are transport files, not GitHub Release assets. A successful CI run does not imply that a local download exists.

## 7. Publication boundary

The packaging workflow does not run on tag pushes and never publishes a Release. Publication uses the eight files already verified in `release/<version>/`; it does not rebuild or replace them. Do not create a tag, create a GitHub Release, or upload assets until the user explicitly selects publication, reviews the notes and asset plan, and gives fresh authorization immediately before the external mutation. Packaging authorization alone is insufficient.
