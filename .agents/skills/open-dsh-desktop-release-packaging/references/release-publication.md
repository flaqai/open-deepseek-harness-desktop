# Desktop Release publication

Read this reference only when the requested endpoint includes Release notes or public Release publication. Packaging and local handoff remain complete without publication.

## 1. Choose the endpoint

Use one of these modes at the beginning of the task:

- **Download only:** build, download, and verify `<primary-checkout>/release/<version>/`.
- **Prepare notes:** also write the bilingual notes file, then stop for review.
- **Publish:** prepare and review the notes, then publish the already verified local assets to GitHub and mirror them to CNB after a fresh, explicit authorization naming both destinations.

When the request does not choose a mode, default to download only. Permission to package, push a branch, or prepare notes is not permission to create a tag, upload assets, or publish a Release. Once the final reviewed plan names both providers, an unqualified approval to upload or publish authorizes that exact verified set on GitHub and CNB. Honor a narrower GitHub-only or CNB-only instruction instead of broadening it.

## 2. Write evidence-bounded notes

Use [release-notes.md](release-notes.md) to derive and fill the tag, title, and body. Write the reviewable notes to `.artifacts/release-notes/<tag>.md`; never place it inside the exact-set `<primary-checkout>/release/<version>/` directory. The default document contains complete Chinese and English sections and uses this evidence:

- the previous published Open DSH Desktop tag and its notes;
- the commit range from that tag to the final source SHA;
- the current upstream baseline and upstream Release notes when applicable;
- the resolved bundled-plugin snapshot and version changes;
- checks and native package results actually completed for this release.

Keep desktop additions, fixes, upstream synchronization, compatibility warnings, downloads, and feedback guidance distinct. Do not repeat capabilities already shipped in the previous desktop Release. Do not claim Windows, macOS, or Linux behavior that was not exercised or established by the accepted native workflows.

Default identity:

```text
tag: odsh-v<version>
title: v<version>
```

Do not infer GitHub Release state only from the version suffix. Record the intended state explicitly. The current CNB synchronization and client update policy distribute only GitHub Releases that are neither drafts nor marked prerelease; therefore a GitHub prerelease cannot complete the dual-target publication flow. A version containing `alpha`, `beta`, or `rc` may be published as a normal GitHub Release only when the user explicitly intends to distribute it as the current public update.

## 3. Review before external mutation

After the notes and local assets are ready, show the user:

- GitHub repository, CNB repository, exact source SHA, tag, title, and intended prerelease/latest state;
- absolute notes path and the complete notes or a reviewable rendering;
- all eight upload paths and their SHA-256 values;
- confirmation that the GitHub Tag and Release do not already exist, and that CNB has no conflicting Release with the same tag;
- confirmation that repository variable `CNB_SYNC_ENABLED` is `true`, the `CNB_TOKEN` secret name exists, and `sync-cnb-desktop-releases.yml` is available on the GitHub default branch;
- the CNB asset model: seven installers are mirrored to the CNB Release, while `SHA256SUMS` is converted into the checksum-bearing `desktop-update-v1.json` anonymous index rather than uploaded as an eighth CNB asset.

Stop for explicit authorization immediately before publication. Do not treat the earlier selection of the publish endpoint as that final authorization.

## 4. Publish the verified set to GitHub

Run the helper once without `--publish` first:

```sh
skill=.agents/skills/open-dsh-desktop-release-packaging

"$skill/scripts/publish-desktop-release.sh" \
  --release-state <stable|prerelease> \
  flaqai/open-deepseek-harness-desktop \
  <source-sha> \
  odsh-v<version> \
  "v<version>" \
  "$PWD/.artifacts/release-notes/odsh-v<version>.md" \
  "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/release/<version>"
```

Only after the final dual-target authorization, repeat the same invocation with `--publish` in addition to the explicit `--release-state`. The helper creates a lightweight tag at the exact SHA, uploads exactly the seven installers and `SHA256SUMS`, publishes directly, and verifies the remote asset digests. Use `stable` for a dual GitHub and CNB publication. Use `prerelease` only for an explicitly GitHub-only prerelease, because the CNB synchronization intentionally excludes it.

The helper refuses to update any existing Release, move a mismatched tag, clobber an asset, or delete a partial Draft. If GitHub leaves a Draft after an interrupted upload, report its URL and stop for a separately authorized recovery decision.

The Desktop packages workflow is qualification-only and manually dispatched. Creating the Release tag must not start another package run or replace this verified asset set.

## 5. Mirror and verify CNB

GitHub publication triggers `sync-cnb-desktop-releases.yml` through the `release.published` event. CNB is downstream of GitHub even though both destinations belong to the same authorized operation.

1. Record the GitHub publication completion time and find the corresponding release-event sync run. Do not mistake an older scheduled or manually dispatched run for this publication.
2. If no release-event run appears after a bounded wait, dispatch the same workflow once under the existing dual-target authorization. Do not dispatch a duplicate while the release-event run is queued or active.
   Set `target_tag` to the exact reviewed GitHub tag. The workflow mirrors only that Release. Leave `delete_tags` empty unless the user has explicitly approved deletion of the listed CNB Releases.
3. Wait for the sync job to finish and require a successful, non-skipped conclusion. The job must read the verified GitHub assets, create or reuse the matching CNB Release, upload the seven installers, and push the refreshed index to CNB `master`.
4. Fetch `desktop-update-v1.json` anonymously from CNB. Require a non-expired index entry whose version and tag match the GitHub Release, whose `withdrawn` value is `false`, and whose seven installer names, sizes, and SHA-256 values exactly match the local `SHA256SUMS` and files.
5. Probe every indexed CNB download URL without credentials and require the declared file size. When CNB exposes a remote digest, require the same SHA-256. Never log the CNB token or credential-bearing clone URL.

The sync is idempotent for an identical tag and asset identity. One retry is allowed for a diagnosed transient GitHub Actions or CNB transport failure while completing the same authorized publication. Stop on invalid credentials, disabled configuration, mismatched remote assets, an ineligible GitHub prerelease, or any change to the tag, notes, asset bytes, or Release state.

GitHub and CNB cannot be committed atomically. If GitHub succeeds and CNB fails, do not delete, unpublish, or mutate the GitHub Release automatically. Report a partial publication with the GitHub URL, failed CNB run, exact safe retry, and whether the anonymous index still points to an older release. Completing CNB with the identical assets remains part of the already authorized operation; changing public content requires a new review and authorization.

## 6. Publication completion

Report both public Release URLs, the GitHub tag target, title, prerelease/latest state, eight verified GitHub assets, seven verified CNB installers, CNB sync run, anonymous index revision and expiry, and the local notes and installer directories. GitHub's generated source ZIP and TAR are additional page entries, not uploaded project assets. Do not describe the release as fully published until both providers pass their verification.
