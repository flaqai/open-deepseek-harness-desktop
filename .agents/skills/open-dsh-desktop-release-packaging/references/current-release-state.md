# Current desktop release state

This historical record describes the most recently completed release, not a new cycle's ledger. New cycles use the release Doctor's machine-readable plan under the Git common directory; its sibling Markdown is a readable snapshot.

## Version lock and source

- Desktop version: `0.2.1-rc.3`; core baseline: `dsh-v0.2.1-rc.3`.
- Tag: [`odsh-v0.2.1-rc.3`](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.2.1-rc.3); title: `v0.2.1-rc.3`. The immutable source commit is recorded in the release Doctor plan.
- Release branch: `release/0.2.1-rc.3`; packaging branch: `fix/windows-packaging-0.2.1-rc.3`. Both branches were pushed at the accepted source commit before packaging. Master already contains the integration locally but was not pushed during this cycle.
- Preserve this version until the user explicitly changes it. Retry, rebuild, synchronization, packaging and publication requests retain the version lock.
- Previous public Release: `odsh-v0.2.1-rc.2.3`. The source delta integrates official rc.3 navigation menus, Creator draft preparation and official API model discovery, plus the community Bundle Loader false-quarantine repair and rc.3 external-tool compatibility manifest.
- Bilingual notes: `.artifacts/release-notes/odsh-v0.2.1-rc.3.md`; validation passed against the previous public tag and fixed source commit. The published body matches the reviewed notes after trailing-newline normalization.

The common bundled-plugin snapshot digest is `b8836b943a8c2657ed5beae989f2b21edacc1beaed70d9bece21b13bbda370dd`. It updates `dshmarket` from `1.69.0` to `1.70.1` and `@xmanrui/dsh-im` from `5.4.0` to `5.6.0`; the other thirteen bundled records are unchanged. Python and Office retain their embedded deployment policy; Node 24.22.1, Electron 44.9.3 and the Python security pins remain unchanged.

## Network and platform qualification

Observed `2026-10-24`: the macOS system proxy at `127.0.0.1:7890` served the release CLI route. GitHub API and official npm endpoint checks passed before dispatch. Actual-artifact download minima were Windows `7.90`, macOS arm64 `7.58`, macOS x64 `7.59`, and Linux `7.70 MiB/s`; each exceeded the `1.0 MiB/s` floor. No packaging-stage retries, replacement handoffs or upload recovery were needed.

| Platform | Accepted run | Qualification |
| --- | --- | --- |
| Windows x64 | [40093663190](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/40093663190) | Native preflight, fresh installation and six real alpha.2 upgrade scenarios passed across user/global mode, target directory and interactive installation; first start, restart, CLI, plugin maintenance, uninstall and persistent-lock checks passed. |
| macOS arm64/x64 | [40095925985](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/40095925985) | Both final DMG/ZIP sets passed resource inventory, Helper layout, deep-signature structure and native Electron initialization on their architecture's runner. |
| Linux x64 | [40095967078](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/40095967078) | DEB/RPM builds and resources-only qualification passed; startup in a real Linux GUI session remains unverified. |

The downloaded macOS arm64 ZIP additionally passed two complete local launches in an isolated Chinese/space path with an empty `DSH_HOME` and Electron's test-only mock Keychain. First readiness took `41135 ms` with Profile deployment; second took `4010 ms` without redeployment. Both recorded Harness/client/event-dispatch readiness, expected anonymous HTTP 401, fifteen seconds of liveness, exit 0, absent PID and closed port after stopping. Evidence: `.artifacts/0.2.1-rc.3-packaged-startup.json`. This does not substitute for manual GUI, Apple notarization or real Keychain authorization evidence. Windows and Linux physical-machine installation beyond the accepted native jobs remain unverified.

The known v0 Session `summary requires notice form` limitation remains outside this release. The reported startup candidate rollback and sign-out failures were not repaired by this patch; the notes identify these limits rather than claiming a fix.

## Verified installer sizes

The exact flat local handoff contains seven installers plus `SHA256SUMS`. Local SHA-256, DMG structure and ZIP payload checks passed. All eight GitHub assets match the local sizes and digests; the CNB anonymous index matches all seven installer names, sizes and SHA-256 values, and seven anonymous download HEAD sizes match. This does not claim seven full CNB downloads.

| Installer | Bytes | MiB |
| --- | ---: | ---: |
| Windows x64 EXE | 457872495 | 436.7 |
| macOS arm64 DMG | 589277823 | 562.0 |
| macOS arm64 ZIP | 569920226 | 543.5 |
| macOS x64 DMG | 607139535 | 579.0 |
| macOS x64 ZIP | 587747263 | 560.5 |
| Linux x64 DEB | 462147800 | 440.7 |
| Linux x64 RPM | 410209905 | 391.2 |

Alternative-format total: `3684315047` bytes, versus the prior qualified set's `3678821204` bytes. Every like-for-like installer increased by `0.1–0.2%`; the total is not one user's download or the installed footprint. The local handoff is `release/0.2.1-rc.3/`, with seven installers and the checksum file.

## Publication state

- GitHub: [odsh-v0.2.1-rc.3](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.2.1-rc.3) is public, non-prerelease and Latest, published `2026-10-24T13:41:16Z`. The tag resolves to the accepted source commit, and eight project asset sizes/digests match the local set. GitHub's generated source archives are separate from these eight assets.
- CNB: release-triggered [40099213938](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/40099213938) succeeded. The [matching Release](https://cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/tag/odsh-v0.2.1-rc.3) is public with seven installers; no duplicate manual sync was dispatched.
- Anonymous index: revision `228`, generated `2026-10-24T13:41:41.804Z`, expires `2026-10-24T19:41:41.804Z`. Exact tag/version, non-withdrawn state, indexed names/sizes/SHA-256 values and seven download HEAD sizes passed `verify-cnb-desktop-release.mjs`.
- The user explicitly authorized the packaging flow and GitHub/CNB publication without another confirmation. Release and packaging branches were pushed; the published tag remains fixed even when later documentation commits record this evidence.

## Recording a completed release

After both destinations pass verification, replace this historical record with observed source/tag identity, accepted runs, platform qualification and limitations, shared plugin snapshot, download route/speeds, exact local set, installer sizes, GitHub state and CNB sync/index facts. Keep partial publication explicit until both pass. Later documentation commits never move the release tag or replace accepted installers.
