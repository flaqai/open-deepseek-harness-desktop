# Desktop Release publication

Read this reference only when the requested endpoint includes Release notes or a public GitHub Release. Packaging and local handoff remain complete without publication.

## 1. Choose the endpoint

Use one of these modes at the beginning of the task:

- **Download only:** build, download, and verify `release/<version>/`.
- **Prepare notes:** also write the bilingual notes file, then stop for review.
- **Publish:** prepare and review the notes, then publish the already verified local assets after a fresh, explicit authorization.

When the request does not choose a mode, default to download only. Permission to package, push a branch, or prepare notes is not permission to create a tag, upload assets, or publish a Release.

## 2. Write evidence-bounded notes

Write the reviewable notes to `.artifacts/release-notes/<tag>.md`; never place it inside the exact-set `release/<version>/` directory. The default document contains complete Chinese and English sections and uses this evidence:

- the previous published Open DSH Desktop tag and its notes;
- the commit range from that tag to the final source SHA;
- the current upstream baseline and upstream Release notes when applicable;
- the resolved bundled-plugin snapshot and version changes;
- checks and native package results actually completed for this release.

Keep desktop additions, fixes, upstream synchronization, compatibility warnings, downloads, and feedback guidance distinct. Do not repeat capabilities already shipped in the previous desktop Release. Do not claim Windows, macOS, or Linux behavior that was not exercised or established by the accepted native workflows.

Default identity:

```text
tag: odsh-v<version>
title: Open DeepSeek Harness Desktop v<version>
```

Any semantic prerelease suffix makes the GitHub Release a prerelease and prevents it from becoming Latest. A stable version becomes Latest.

## 3. Review before external mutation

After the notes and local assets are ready, show the user:

- repository, exact source SHA, tag, title, and prerelease/latest state;
- absolute notes path and the complete notes or a reviewable rendering;
- all eight upload paths and their SHA-256 values;
- confirmation that the remote Tag and Release do not already exist.

Stop for explicit authorization immediately before publication. Do not treat the earlier selection of the publish endpoint as that final authorization.

## 4. Publish the verified set

Run the helper once without `--publish` first:

```sh
skill=.agents/skills/open-dsh-desktop-release-packaging

"$skill/scripts/publish-desktop-release.sh" \
  flaqai/open-deepseek-harness-desktop \
  <source-sha> \
  odsh-v<version> \
  "Open DeepSeek Harness Desktop v<version>" \
  "$PWD/.artifacts/release-notes/odsh-v<version>.md" \
  "$PWD/release/<version>"
```

Only after the final authorization, repeat the same invocation with `--publish` before the positional arguments. The helper creates a lightweight tag at the exact SHA, uploads exactly the seven installers and `SHA256SUMS`, publishes directly, and verifies the remote asset digests.

The helper refuses to update any existing Release, move a mismatched tag, clobber an asset, or delete a partial Draft. If GitHub leaves a Draft after an interrupted upload, report its URL and stop for a separately authorized recovery decision.

The Desktop packages workflow is qualification-only and manually dispatched. Creating the Release tag must not start another package run or replace this verified asset set.

## 5. Publication completion

Report the public Release URL, tag target, title, prerelease/latest state, eight verified remote assets, and the local notes and installer directories. GitHub's generated source ZIP and TAR are additional page entries, not uploaded project assets.
