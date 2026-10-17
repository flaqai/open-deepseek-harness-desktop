# Current desktop release state

This file records the most recently completed desktop release. It is historical evidence, not the ledger for a new packaging cycle. New cycles use the release Doctor's machine-readable plan under the Git common directory; its generated Markdown sibling is the readable view.

## Version lock

- Target version: `0.2.1-rc.2`
- Tag: `odsh-v0.2.1-rc.2`
- Title: `v0.2.1-rc.2`
- Release branch: `release/0.2.1-rc.2`
- Packaging branch: `fix/windows-packaging-0.2.1-rc.2`
- Lock rule: preserve this version and identity until the user explicitly requests a version change. A request to retry, rebuild, synchronize, package, upload, or publish preserves this lock.

## Recorded source state

Last observed: `2026-10-18 02:51 CST`

| Item | Recorded value | State |
| --- | --- | --- |
| Final source | `odsh-v0.2.1-rc.2` | accepted by all three platform runs; the release Doctor plan records its full SHA |
| Upstream baseline | `dsh-v0.2.1-rc.2` | retained as a merge ancestor |
| Branch synchronization | master, release and packaging branches pushed | all matched the accepted source at publication; the later historical-record commit does not move the tag or installers |
| Previous public Release | `odsh-v0.2.1-alpha.4` | release-note comparison base; 53 commits through the accepted source |
| Release notes | `.artifacts/release-notes/odsh-v0.2.1-rc.2.md` | bilingual notes validated; published GitHub body matches the final file |
| Bundled plugins | `b6fbc4dbc714a6d1a50fdb54d673ae698d15b65cdfff1d37572ee20c895ba303` | identical snapshot in all accepted runs; dshmarket `1.66.28` → `1.66.35`, other bundled versions unchanged from the published baseline |

## Network preflight

| Item | Recorded value |
| --- | --- |
| Adopted route | macOS system proxy through `127.0.0.1:7890` |
| Required download floor | `1.0 MiB/s` |
| Actual-artifact samples | Windows minimum `7.94`, macOS arm64 `7.63`, macOS x64 `1.72`, Linux `7.77 MiB/s`; all passed |
| Transfer result | no low-speed stop; parallel installer transfers reached approximately `40–57 MiB/s` |
| Local log cache | GH run-log reads used a writable temporary XDG cache; no user-wide configuration or credentials were changed |

## Platform delivery matrix

All accepted runs built the same final source and reused the Windows run's bundled-plugin snapshot.

| Platform | Workflow run | Native qualification | Local exact set | GitHub | CNB |
| --- | --- | --- | --- | --- | --- |
| Windows x64 | [39053733080](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/39053733080) | fast preflight, EXE build, installed startup, upgrade, uninstall, CLI and plugin checks passed | verified | public | public |
| macOS arm64/x64 | [39055492429](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/39055492429) | final DMG/ZIP resources, Helper layout, deep signatures and native Electron initialization passed on each matching runner | verified | public | public |
| Linux x64 | [39055536824](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/39055536824) | native DEB/RPM builds and resources-only package qualification passed; real desktop-session GUI startup unverified | verified | public | public |

The downloaded arm64 ZIP also passed a local complete-startup probe using new Chinese/space paths, empty configuration, and Electron's test-only mock Keychain. First readiness: `38121 ms` with Profile deployment; second readiness: `4008 ms` without redeployment. Both launches recorded Harness/client/event-dispatch readiness, expected anonymous HTTP 401, 15 seconds of continued liveness, exit code 0, an independently absent PID, and closed ports. This is not a manual GUI feature test or real Keychain authorization/migration evidence. No production Keychain settings or system protections changed. Evidence: `.artifacts/rc2-packaged-startup.json`; runner: `.artifacts/rc2-packaged-startup.mjs`.

## Installer sizes

All seven local installers match workflow checksums and GitHub asset digests. CNB's anonymous index records the same sizes and SHA-256 values; all seven anonymous download HEAD sizes match.

| Installer | Bytes | MiB |
| --- | ---: | ---: |
| Windows x64 EXE | 455775786 | 434.7 |
| macOS arm64 DMG | 586988408 | 559.8 |
| macOS arm64 ZIP | 567717984 | 541.4 |
| macOS x64 DMG | 604882741 | 576.9 |
| macOS x64 ZIP | 585530895 | 558.4 |
| Linux x64 DEB | 459854212 | 438.6 |
| Linux x64 RPM | 407743109 | 388.9 |

The combined alternative formats total `3668493135` bytes, compared with the previous qualified set's `3666575855` bytes. Every like-for-like installer increased by less than 0.1%; the combined total is not one user's download or the installed footprint. Size report: `.artifacts/rc2-installer-sizes.txt`.

## Publication state

- GitHub: [odsh-v0.2.1-rc.2](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.2.1-rc.2) is public, stable, non-prerelease and Latest, published `2026-10-17T18:40:23Z`. Its tag resolves to the final source above.
- GitHub assets: seven installers plus `SHA256SUMS`, all verified by remote size and SHA-256. The page additionally includes GitHub's two generated source archives, for ten displayed entries. Python/Office remain embedded resources, not additional Release assets.
- CNB: release-triggered [39059127607](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/39059127607) succeeded; no duplicate manual dispatch. The [matching CNB Release](https://cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/tag/odsh-v0.2.1-rc.2) is public with seven installers.
- Anonymous index: revision `188`, generated `2026-10-17T18:40:47.758Z`, expires `2026-10-18T00:40:47.758Z`. Exact tag/version, non-withdrawn state, all indexed installer names/sizes/SHA-256 values, and anonymous HEAD sizes passed `verify-cnb-desktop-release.mjs`. Evidence: `.artifacts/rc2-cnb-verification.txt`.
- Local handoff: `<primary-checkout>/release/0.2.1-rc.2/`, exactly seven installers and `SHA256SUMS`; all checksums, ZIP payloads and DMG structures verified. The activated directory is read-only.
- Publication authorization: the user explicitly approved GitHub publication and CNB synchronization without another confirmation for this release.

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
