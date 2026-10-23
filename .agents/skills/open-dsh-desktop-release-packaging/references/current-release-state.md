# Current desktop release state

This historical record describes the most recently completed release, not a new cycle's ledger. New cycles use the release Doctor's machine-readable plan under the Git common directory; its sibling Markdown is a readable snapshot.

## Version lock and source

- Desktop version: `0.2.1-rc.2.3`; core baseline: `dsh-v0.2.1-rc.2`.
- Tag: [`odsh-v0.2.1-rc.2.3`](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.2.1-rc.2.3); title: `v0.2.1-rc.2.3`. The immutable source commit is recorded in the release Doctor plan.
- Release branch: `release/0.2.1-rc.2.3`; packaging branch: `fix/windows-packaging-0.2.1-rc.2.3`. The release branch was pushed at the source commit before packaging. Master was not moved for this cycle.
- Preserve this version until the user explicitly changes it. Retry, rebuild, synchronization, packaging and publication requests retain the version lock.
- Previous public Release: `odsh-v0.2.1-rc.2.2`. Four grouped commits cover the runtime security refresh, Markdown image repair, plugin market proxy/YAML/external-anchor repair, and paired documentation.
- Bilingual notes: `.artifacts/release-notes/odsh-v0.2.1-rc.2.3.md`; validation passed against the previous public tag and fixed source commit. The published body matches the reviewed notes after trailing-newline normalization.

The common bundled-plugin snapshot digest is `fb1a88bcf083d27e0931081b5ebf5bb8637e0466249b3bdd997207ba8d4b518a`. It updates `dshmarket` from `1.66.45` to `1.69.0`; the other fourteen bundled records are unchanged. Python and Office retain their embedded deployment policy.

## Network and platform qualification

Observed `2026-10-23`: the macOS system proxy at `127.0.0.1:7890` served the release CLI route. Actual-artifact download minima were Windows `2.08`, macOS arm64 `6.06`, macOS x64 `3.32`, and Linux `5.94 MiB/s`; each exceeded the `1.0 MiB/s` floor. A transient GitHub API EOF during run monitoring recovered without rebuilding. A second EOF occurred only after all eight GitHub assets were uploaded and the Release was published; independent API reads confirmed publication, tag, Latest state and asset identities.

| Platform | Accepted run | Qualification |
| --- | --- | --- |
| Windows x64 | [39906944853](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/39906944853) | Native preflight, fresh installation and six real alpha.2 upgrade scenarios passed across user mode, target directory and interactive installation; first start, restart, CLI, plugin maintenance, uninstall and persistent-lock checks passed. |
| macOS arm64/x64 | [39910294015](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/39910294015) | Both final DMG/ZIP sets passed resource inventory, Helper layout, deep-signature structure and native Electron initialization on their architecture's runner. |
| Linux x64 | [39910356661](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/39910356661) | DEB/RPM builds and resources-only qualification passed; startup in a real Linux GUI session remains unverified. |

The downloaded macOS arm64 ZIP additionally passed two complete local launches in an isolated Chinese/space path with an empty `DSH_HOME` and Electron's test-only mock Keychain. First readiness took `42139 ms` with Profile deployment; second took `5009 ms` without redeployment. Both recorded Harness/client/event-dispatch readiness, expected anonymous HTTP 401, fifteen seconds of liveness, exit 0, absent PID and closed port after stopping. Evidence: `.artifacts/0.2.1-rc.2.3-packaged-startup.json`. This does not substitute for manual GUI or real Keychain authorization evidence. Windows and Linux physical-machine installation beyond the accepted native jobs remain unverified.

The known v0 Session `summary requires notice form` limitation remains outside this release. The reported startup candidate rollback and sign-out failures were not repaired by this patch; the notes identify these limits rather than claiming a fix.

## Verified installer sizes

The exact flat local handoff contains seven installers plus `SHA256SUMS`. Local SHA-256, DMG structure and ZIP payload checks passed. All eight GitHub assets match the local sizes and digests; the CNB anonymous index matches all seven installer names, sizes and SHA-256 values, and seven anonymous download HEAD sizes match. This does not claim seven full CNB downloads.

| Installer | Bytes | MiB |
| --- | ---: | ---: |
| Windows x64 EXE | 456999322 | 435.8 |
| macOS arm64 DMG | 588497473 | 561.2 |
| macOS arm64 ZIP | 569211546 | 542.8 |
| macOS x64 DMG | 606368099 | 578.3 |
| macOS x64 ZIP | 587052811 | 559.9 |
| Linux x64 DEB | 461391680 | 440.0 |
| Linux x64 RPM | 409300273 | 390.3 |

Alternative-format total: `3678821204` bytes, versus the prior qualified set's `3672450369` bytes. Every like-for-like installer increased by `0.1–0.3%`; the total is not one user's download or the installed footprint. The local handoff is `release/0.2.1-rc.2.3/`, with seven installers and the checksum file.

## Publication state

- GitHub: [odsh-v0.2.1-rc.2.3](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.2.1-rc.2.3) is public, non-prerelease and Latest, published `2026-10-23T07:23:23Z`. The tag resolves to the accepted source commit, and eight project asset sizes/digests match the local set. GitHub's generated source archives are separate from these eight assets.
- CNB: release-triggered [39917384644](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/39917384644) succeeded. The [matching Release](https://cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/tag/odsh-v0.2.1-rc.2.3) is public with seven installers; no duplicate manual sync was dispatched.
- Anonymous index: revision `220`, generated `2026-10-23T07:24:03.031Z`, expires `2026-10-23T13:24:03.031Z`. Exact tag/version, non-withdrawn state, indexed names/sizes/SHA-256 values and seven download HEAD sizes passed `verify-cnb-desktop-release.mjs`.
- The user explicitly authorized grouped commits, pushes, three-platform packaging and verification, GitHub publication and CNB synchronization without another confirmation for this release.

## Recording a completed release

After both destinations pass verification, replace this historical record with observed source/tag identity, accepted runs, platform qualification and limitations, shared plugin snapshot, download route/speeds, exact local set, installer sizes, GitHub state and CNB sync/index facts. Keep partial publication explicit until both pass. Later documentation commits never move the release tag or replace accepted installers.
