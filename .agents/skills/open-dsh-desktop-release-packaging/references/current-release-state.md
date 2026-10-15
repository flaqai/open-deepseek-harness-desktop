# Current desktop release state

This file records the most recently completed desktop release. It is historical evidence, not the ledger for a new packaging cycle. New cycles use the release Doctor's machine-readable plan under `<git-common-dir>/odsh-release-state/<version>.plan.json`; its generated Markdown sibling is the readable view.

## Version lock

- Target version: `0.2.1-alpha.3`
- Tag: `odsh-v0.2.1-alpha.3`
- Title: `v0.2.1-alpha.3`
- Release branch: `release/0.2.1-alpha.3`
- Packaging branch: `fix/windows-packaging-0.2.1-alpha.3`
- Lock rule: preserve this version and identity until the user explicitly requests a version change. A request to retry, rebuild, synchronize, package, upload, or publish preserves this lock.

## Recorded source state

Last observed: `2026-10-15 22:21 CST`

| Item | Recorded value | State |
| --- | --- | --- |
| Final source | `odsh-v0.2.1-alpha.3` | published tag identifies the accepted build source; the release Doctor plan records its full SHA |
| Branch synchronization | release preparation and packaging fix pushed | packaging branch contains the build-order fix after release preparation; master is unchanged by packaging |
| Previous public Release | `odsh-v0.2.1-alpha.2` | release-note comparison base |
| Release notes | `.artifacts/release-notes/odsh-v0.2.1-alpha.3.md` | bilingual notes validated against the previous public Release and final source; published body matches the reviewed file |
| Bundled plugins | `7355bee72aec0e4500be85c2633d6f3a1e0476c83b1811c7436ca3ce2e8c4018` | matching snapshot in all three accepted platform runs |

## Network preflight

| Item | Recorded value |
| --- | --- |
| Adopted route | explicit proxy through `127.0.0.1:7890` |
| Required download floor | `1.0 MiB/s` |
| Last result | passed; slowest observed sample `2.91 MiB/s`; Windows minimum `5.44`, macOS arm64 `2.91`, macOS x64 `6.12`, Linux `5.85 MiB/s`; no low-speed stop |
| Dispatch permission | all native builds, downloads, and exact-set verification completed |

## Platform delivery matrix

All accepted runs built from the commit named by `odsh-v0.2.1-alpha.3`.

| Platform | Workflow run | Native qualification | Local exact set | GitHub | CNB |
| --- | --- | --- | --- | --- | --- |
| Windows x64 | [38721827443](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/38721827443) | native installed-package qualification passed | verified | public | public |
| macOS arm64/x64 | [38724602143](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/38724602143) | final DMG/ZIP resources and native startup passed on each matching runner; no separate manual GUI inspection | verified | public | public |
| Linux x64 | [38724674255](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/38724674255) | native DEB/RPM builds and installed-resource verification passed; real desktop-session GUI startup unverified | verified | public | public |

## Publication state

- GitHub tag and Release: `odsh-v0.2.1-alpha.3` is [public, stable, non-prerelease and Latest](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.2.1-alpha.3), published `2026-10-15T14:13:29Z`.
- GitHub assets: seven platform installers plus `SHA256SUMS`; every published asset passed size and SHA-256 checks against the local exact set. Python and Office resources remain inside the installers; no separate runtime archive is uploaded.
- CNB synchronization: [release-triggered run 38749487409](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/38749487409) succeeded without a duplicate manual dispatch.
- CNB anonymous update index: revision `174`, generated `2026-10-15T14:13:57.417Z`, expires `2026-10-15T20:13:57.417Z`; the exact-tag entry, all seven indexed sizes and SHA-256 values, and anonymous HEAD byte sizes were verified. The [CNB Release](https://cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/tag/odsh-v0.2.1-alpha.3) is public.
- Local handoff directory: `/Users/6677h/StudioProjects/flaq-deepseek-harness/open-deepseek-harness-desktop/release/0.2.1-alpha.3`, containing exactly seven installers and `SHA256SUMS`; local checksums, ZIP payloads and DMG structures verified.
- Publication authorization: the user explicitly approved public upload to GitHub and CNB for this release.

## Recording a completed release

After a release is fully verified and published, replace this historical record with observed final facts:

- final source branch, immutable workflow run, and branch synchronization;
- network measurement and floor;
- each platform run ID, head SHA, result, and native qualification;
- bundled-plugin snapshot identity;
- local download directory and exact-set verification;
- GitHub tag, Release state, asset visibility, and URL;
- CNB sync run, Release/index visibility, revision, expiry, and URL.

Use explicit states such as `not started`, `running`, `succeeded`, `failed`, `downloaded`, `verified`, and `public`. Keep each platform independent; one public platform does not make the release fully public.
