---
name: open-dsh-desktop-release-packaging
description: Prepare, build, monitor, download, verify, and optionally publish Open DeepSeek Harness Desktop releases to GitHub and CNB. Use for release or packaging branches, Windows-first cross-platform runs, packaging-fix retries, local artifact handoff, bilingual Release notes, or publishing the exact verified installers. Default to local handoff; tags, uploads, and public Releases require fresh explicit authorization.
---

# Open DSH Desktop release packaging

Package one source revision into Windows x64, macOS arm64/x64, and Linux x64 installers, then prove that every local file came from a successful run and matches the workflow checksum. Optionally prepare bilingual notes and publish that exact local set.

## Before changing Git state

Read [references/release-runbook.md](references/release-runbook.md). Inspect the main checkout and every worktree before choosing the release base. Preserve unrelated dirty changes and identify unmerged work rather than assuming that every worktree belongs in the release.

Choose the requested endpoint before starting:

- download and verify only;
- download, verify, and prepare bilingual Release notes;
- download, verify, prepare notes, and publish to GitHub plus CNB after review.

When the request does not choose one, use download-only. For either notes or publication, also read [references/release-publication.md](references/release-publication.md) and [references/release-notes.md](references/release-notes.md).

Treat these as separate authorizations:

- editing or committing the release version;
- pushing release or packaging-fix branches;
- creating or pushing a tag;
- creating a GitHub Release or uploading public assets to GitHub and CNB.

An earlier permission to push a packaging-fix branch does not authorize a tag or Release.

## Required invariants

- Use `.github/workflows/desktop-packages.yml`; do not substitute a local cross-build for the native runners.
- Run `windows-x64` first, then `macos`, then `linux-x64` when the user requests the established staged flow.
- Keep `publish=false` during package qualification.
- Every accepted platform run must use the same final Git commit. If a packaging fix changes the commit, rebuild every platform already accepted from the older commit.
- The workflow resolves current stable registry-backed bundled plugins. When separate platform runs are used, compare the complete `bundled-plugin-snapshot` artifact contents; mismatched snapshots are not one coherent release set.
- The local handoff directory is exactly `<primary-checkout>/release/<version>/`, where `<primary-checkout>` is the main checkout that owns the repository's Git common directory. It never follows a temporary release or fix worktree. In this workspace that resolves to `/Users/6677h/StudioProjects/flaq-deepseek-harness/open-deepseek-harness-desktop/release/<version>/`. The directory is flat and contains exactly seven installers plus `SHA256SUMS`; it contains no platform subdirectories, run metadata, snapshot metadata, or other files.
- A GitHub Release page shows ten entries because GitHub adds source ZIP and TAR archives to the eight uploaded files. Do not download those generated source archives into the local handoff directory or upload replacements for them.
- A green build is not a downloaded deliverable. Download the named artifacts, verify the CI checksums, and report exact local paths.
- CNB publication is downstream of the verified GitHub Release: the repository sync workflow mirrors the seven installers and writes the anonymous checksum-bearing update index. It is one authorized dual-target operation, but it is not atomic across providers.
- Every CNB sync selects exactly one GitHub Release tag. A manual retry must pass that reviewed tag through the workflow's `target_tag` input; never enumerate recent Releases or use a multi-Release backfill to retry one publication. The optional `delete_tags` input is destructive recovery only and requires the user's exact approved tag list.
- Before asking for final publication authorization, verify `CNB_SYNC_ENABLED=true`, confirm the `CNB_TOKEN` secret name is configured, and confirm the sync workflow is available on the default branch. A draft or GitHub prerelease is intentionally ineligible for CNB distribution; resolve the intended Release state before publishing.
- Do not call publication complete until the CNB sync run succeeds and the anonymous index exposes the exact tag, installer names, sizes, and SHA-256 values from the verified local set. A GitHub success followed by a CNB failure is a partial publication, not a success.
- macOS qualification requires the final DMG and ZIP to pass `apps/desktop/scripts/smoke-macos-package.mjs` on each matching native runner before upload. Follow the macOS startup checks in the runbook; valid signatures and matching checksums alone do not establish launchability.
- Never adopt a partial file from `gh` temporary storage or pair a resumable signed URL with a guessed artifact filename. A ZIP central directory can look plausible while its payload belongs to another artifact.

## Execution

For an explicitly requested macOS-only repair, use `target=macos` and `refresh_plugins=false` to retain the committed plugin archives. Download with `scripts/download-desktop-release.sh --macos-only <owner/repo> <run-id>` into the primary checkout's `release/<version>/`. This partial handoff contains four macOS installers and their `SHA256SUMS`; verify it with `scripts/verify-release-directory.sh --macos-only <directory>`. Do not present this subset as a rebuilt eight-file release or overwrite the full Release checksum file with its four-entry checksum file. Retained Windows/Linux assets keep their original source provenance.

1. Confirm the version, base branch, final source commit, expected branch names, remote, and publication boundary.
2. Create `release/<version>` from the confirmed base. Change only `apps/desktop/package.json` when that is the sole desktop version owner, then run proportionate checks and commit.
3. Create or update the packaging-fix branch from that release revision. Reuse old Windows fixes only after proving whether they are already ancestors of the release.
4. Push only the authorized branches and dispatch the workflow sequentially. Capture each run ID and head SHA.
5. Watch each run to completion. On failure, inspect failed logs, implement the narrow fix on the packaging-fix branch, push, and retry. Do not accept skipped smoke tests or checksum jobs as success.
6. After all three targets succeed, download them together with [scripts/download-desktop-release.sh](scripts/download-desktop-release.sh). The helper uses a stable system-temporary staging directory, resumes verified artifact IDs, compares the three source SHAs and bundled-plugin snapshots, resolves the primary checkout through Git's common directory, then atomically creates the flat `<primary-checkout>/release/<version>/` directory. Do not replace it with an ad-hoc downloader or place the final handoff under the active release worktree.
7. Re-run [scripts/verify-release-directory.sh](scripts/verify-release-directory.sh) before handoff. It rejects a missing installer, an extra file, a nested directory, an incorrect checksum, or a malformed ZIP.
8. Confirm the Git checkout is clean and report the three accepted workflow runs and the helper's common source SHA and snapshot digest.
9. If notes were requested, derive and fill the tag, title, and complete Chinese and English body according to [references/release-notes.md](references/release-notes.md), write `.artifacts/release-notes/<tag>.md`, and stop for review. Do not hand the user an empty template or ask them to reconstruct the change list. If publication was requested, show the final tag, SHA, title, notes, assets, checksums, GitHub destination, CNB destination, and intended Release state, then obtain fresh explicit authorization immediately before running the dual-target publication flow in the publication reference.

Do not run Playwright or `test:web` as part of this workflow unless the user separately requests them or a packaging failure specifically requires them.

## Completion report

Lead with the outcome. Include the release and fix branch names, final commit, commits created, exact checks run, workflow run links, local artifact directory, per-file checksum result, and any non-blocking workflow warning. State explicitly whether `master`, tags, or a public Release was pushed or created. For publication, report the notes path, GitHub and CNB URLs, tag target, prerelease/latest state, CNB sync run and index revision, and remote identity verification for both providers. If only one provider completed, call the result partial and name the remaining recovery action.
