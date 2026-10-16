# Current desktop release state

This file records the most recently completed desktop release. It is historical evidence, not the ledger for a new packaging cycle. New cycles use the release Doctor's machine-readable plan under `<git-common-dir>/odsh-release-state/<version>.plan.json`; its generated Markdown sibling is the readable view.

## Version lock

- Target version: `0.2.1-alpha.4`
- Tag: `odsh-v0.2.1-alpha.4`
- Title: `v0.2.1-alpha.4`
- Release branch: `release/0.2.1-alpha.4`
- Packaging branch: `fix/windows-packaging-0.2.1-alpha.4`
- Lock rule: preserve this version and identity until the user explicitly requests a version change. A request to retry, rebuild, synchronize, package, upload, or publish preserves this lock.

## Recorded source state

Last observed: `2026-10-16 20:52 CST`

| Item | Recorded value | State |
| --- | --- | --- |
| Final source | `odsh-v0.2.1-alpha.4` | published tag identifies the accepted build source; the release Doctor plan records its full SHA |
| Branch synchronization | master, release and packaging branches pushed | all three remote branches match the accepted tag at publication; the later publication-record commit does not change the tag or installers |
| Previous public Release | `odsh-v0.2.1-alpha.3` | release-note comparison base |
| Release notes | `.artifacts/release-notes/odsh-v0.2.1-alpha.4.md` | bilingual notes validated against the previous public Release and final source; published body matches the reviewed file |
| Bundled plugins | `fd1db3d1b30c4e79ded1a5c0d14bb553b6093bfddbe2da75ba027b881f66ace3` | matching snapshot in all three accepted platform runs; dshmarket changed from `1.66.22` to `1.66.28` against the published baseline |

## Network preflight

| Item | Recorded value |
| --- | --- |
| Adopted route | explicit proxy through `127.0.0.1:7890` |
| Required download floor | `1.0 MiB/s` |
| Last result | passed; Windows minimum `7.12`, macOS arm64 `7.17`, macOS x64 `7.29`, Linux `7.74 MiB/s`; no low-speed stop |
| Dispatch permission | all native builds, downloads, and exact-set verification completed |

## Platform delivery matrix

All accepted runs built from the commit named by `odsh-v0.2.1-alpha.4`.

| Platform | Workflow run | Native qualification | Local exact set | GitHub | CNB |
| --- | --- | --- | --- | --- | --- |
| Windows x64 | [38893338495](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/38893338495) | native installed-package qualification passed | verified | public | public |
| macOS arm64/x64 | [38895825434](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/38895825434) | final DMG/ZIP resources and native startup passed on each matching runner; no separate manual GUI inspection | verified | public | public |
| Linux x64 | [38895895579](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/38895895579) | native DEB/RPM builds and installed-resource verification passed; real desktop-session GUI startup unverified | verified | public | public |

The additional local arm64 ZIP probe uses an empty Profile, isolated app data and Electron's test-only mock keychain; it records first readiness at `38102 ms`, second readiness at `4009 ms`, Harness/client/event-dispatch readiness, authenticated HTTP protection, and continued Electron liveness. The second launch does not redeploy the Profile, and both ports close after shutdown. Real Keychain authorization and credential migration are unverified by this additional probe; no production Keychain setting or permission changes. Evidence: `.artifacts/alpha4-packaged-startup.json`.

## Installer sizes

All seven local installers match workflow checksums and published GitHub asset digests. CNB's index records the same sizes and SHA-256 values; anonymous download HEAD sizes also match.

| Installer | Bytes | MiB |
| --- | ---: | ---: |
| Windows x64 EXE | 455424508 | 434.3 |
| macOS arm64 DMG | 586678720 | 559.5 |
| macOS arm64 ZIP | 567455797 | 541.2 |
| macOS x64 DMG | 604605509 | 576.6 |
| macOS x64 ZIP | 585266388 | 558.2 |
| Linux x64 DEB | 459636556 | 438.3 |
| Linux x64 RPM | 407508377 | 388.6 |

The combined alternative installer formats total `3666575855` bytes, compared with `3668255741` bytes for the previous qualified Release. This total is not one user's download or installed application size.

## Publication state

- GitHub tag and Release: `odsh-v0.2.1-alpha.4` is [public, stable, non-prerelease and Latest](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.2.1-alpha.4), published `2026-10-16T12:45:01Z`.
- GitHub assets: seven platform installers plus `SHA256SUMS`; every published asset passed size and SHA-256 checks against the local exact set. Python and Office resources remain inside the installers; no separate runtime archive is uploaded.
- CNB synchronization: [release-triggered run 38902727943](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/38902727943) succeeded without a duplicate manual dispatch.
- CNB anonymous update index: revision `180`, generated `2026-10-16T12:45:28.683Z`, expires `2026-10-16T18:45:28.683Z`; the exact-tag entry, all seven indexed sizes and SHA-256 values, and anonymous HEAD byte sizes were verified. The [CNB Release](https://cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/tag/odsh-v0.2.1-alpha.4) is public.
- Local handoff directory: `/Users/6677h/StudioProjects/flaq-deepseek-harness/open-deepseek-harness-desktop/release/0.2.1-alpha.4`, containing exactly seven installers and `SHA256SUMS`; local checksums, ZIP payloads and DMG structures verified; activated directory is read-only.
- Publication authorization: the user explicitly approved public upload to GitHub and CNB without another confirmation for this release.

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
