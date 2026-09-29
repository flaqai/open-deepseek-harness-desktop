# Current desktop release state

This file records the most recently completed desktop release. It is historical evidence, not the ledger for a new packaging cycle. New cycles use the release Doctor's machine-readable plan under `<git-common-dir>/odsh-release-state/<version>.plan.json`; its generated Markdown sibling is the readable view.

## Version lock

- Target version: `0.1.7-rc.2.1`
- Tag: `odsh-v0.1.7-rc.2.1`
- Title: `v0.1.7-rc.2.1`
- Release branch: `release/0.1.7-rc.2.1`
- Packaging branch: `fix/windows-packaging-0.1.7-rc.2.1`
- Lock rule: preserve this version and identity until the user explicitly requests a version change. A request to retry, rebuild, synchronize, package, upload, or publish preserves this lock.

## Recorded source state

Last observed: `2026-09-29 19:27 CST`

| Item | Recorded value | State |
| --- | --- | --- |
| Final source | `odsh-v0.1.7-rc.2.1` | published tag identifies the accepted build source; the release Doctor plan records its full SHA |
| Previous public Release | `odsh-v0.1.7-rc.2` | release-note comparison base |
| Release notes | `.artifacts/release-notes/odsh-v0.1.7-rc.2.1.md` | bilingual notes validated against the previous public Release and final source |
| Bundled plugins | `b3e980f5a0ba887e26fc42c35fa6063a6c8b4cd421e8db7de8240001b6305561` | matching snapshot in all three accepted platform runs |

## Network preflight

| Item | Recorded value |
| --- | --- |
| Adopted route | explicit proxy through `127.0.0.1:7890` |
| Required download floor | `1.0 MiB/s` |
| Last result | passed; slowest observed sample `3.39 MiB/s` |
| Dispatch permission | all native builds, downloads, and exact-set verification completed |

## Platform delivery matrix

All accepted runs built from the commit named by `odsh-v0.1.7-rc.2.1`.

| Platform | Workflow run | Native qualification | Local exact set | GitHub | CNB |
| --- | --- | --- | --- | --- | --- |
| Windows x64 | [36529700320](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/36529700320) | installed-package startup reached `dsh web`, client ready, event dispatch ready, and first-start bundled-plugin commit | verified | public | public |
| macOS arm64/x64 | [36531870619](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/36531870619) | CI native DMG/ZIP smoke passed for both architectures; isolated local arm64 GUI launch reached the welcome screen and both readiness signals; x64 GUI was not manually inspected | verified | public | public |
| Linux x64 | [36531924037](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/36531924037) | packaged resource, DEB/RPM and checksum jobs passed | verified | public | public |

## Publication state

- GitHub tag and Release: `odsh-v0.1.7-rc.2.1` is [public, stable, non-prerelease and Latest](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.1.7-rc.2.1), published `2026-09-29T11:20:27Z`.
- GitHub assets: seven platform installers plus `SHA256SUMS`; every published asset passed size and SHA-256 checks against the local exact set. No optional runtime archive is part of this Release.
- CNB synchronization: [release-triggered run 36561129000](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/36561129000) succeeded without a duplicate manual dispatch.
- CNB anonymous update index: revision `102`, generated `2026-09-29T11:20:58.775Z`, expires `2026-09-29T17:20:58.775Z`; the exact-tag entry and anonymous HEAD byte sizes for all seven installers were verified. The [CNB Release](https://cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/tag/odsh-v0.1.7-rc.2.1) is public.
- Local handoff directory: `/Users/6677h/StudioProjects/flaq-deepseek-harness/open-deepseek-harness-desktop/release/0.1.7-rc.2.1`, containing exactly seven installers and `SHA256SUMS`.
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
