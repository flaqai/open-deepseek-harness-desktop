# Current desktop release state

This historical record describes the most recently completed release, not a new cycle's ledger. New cycles use the release Doctor's machine-readable plan under the Git common directory; its sibling Markdown is a readable snapshot.

## Version lock and source

- Desktop version: `0.2.1-rc.2.1`; core baseline: `dsh-v0.2.1-rc.2`.
- Tag: `odsh-v0.2.1-rc.2.1`; title: `v0.2.1-rc.2.1`.
- Release branch: `release/0.2.1-rc.2.1`; packaging branch: `fix/windows-packaging-0.2.1-rc.2.1`.
- Preserve this identity until the user explicitly changes the version. Retry, rebuild, synchronization, packaging and publication requests preserve the lock.
- The immutable tag matches all three accepted runs; the Doctor plan records the full source SHA. Master, release and packaging branches matched that source before publication and were pushed. Later README and historical-record commits do not move the tag or installers.
- Previous public Release: `odsh-v0.2.1-rc.2`; 46 commits through the accepted source.
- Bilingual notes: `.artifacts/release-notes/odsh-v0.2.1-rc.2.1.md`; validation passed and the published GitHub body matches.

The common logical bundled-plugin snapshot is `feb6695dd3e0e13e7854e1c9fb6abd4d79886f01602082e9d07f78205bf64ca4`. It updates `dshmarket` from `1.66.35` to `1.66.45`, `@xmanrui/dsh-im` from `4.39.0` to `5.3.0`, and `@ychris12138/dsh-usage-stats` from `0.3.5` to `0.3.6`. The other twelve bundled records are unchanged. Python and Office retain their embedded deployment policy.

## Network and platform qualification

Observed `2026-10-21`: GitHub API and official npm connectivity passed through the macOS system proxy at `127.0.0.1:7890`. Actual-artifact download minima were Windows `6.52`, macOS arm64 `7.44`, macOS x64 `7.63`, and Linux `7.53 MiB/s`, above the unchanged `1.0 MiB/s` floor. No low-speed stop occurred; range transfers reached approximately `45–57 MiB/s`.

| Platform | Accepted run | Qualification |
| --- | --- | --- |
| Windows x64 | [39481965350](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/39481965350) | fresh installation and six real alpha.2 upgrade scenarios passed: standard/admin users, same/changed directories and interactive installation; native stable-process-handle and deny-delete lock tests passed |
| macOS arm64/x64 | [39485865105](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/39485865105) | both final DMG/ZIP sets passed installed-resource, Helper-layout, deep-signature and native Electron initialization checks |
| Linux x64 | [39485952053](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/39485952053) | DEB/RPM builds and resources-only qualification passed; GUI startup in a real desktop session remains unverified |

The downloaded arm64 ZIP additionally passed two complete local launches using new Chinese/space paths, empty configuration and Electron's test-only mock Keychain. First readiness took `39234 ms` with Profile deployment; second took `4008 ms` without redeployment. Both recorded Harness/client/event-dispatch readiness, expected anonymous HTTP 401, fifteen seconds of liveness, exit 0, absent PID and closed ports after stopping. An initial restricted launch aborted during macOS application registration before application code; the unchanged test passed in the permitted native environment. Evidence: `.artifacts/0.2.1-rc.2.1-packaged-startup.json`; the restricted failure is retained separately. This is not manual GUI or real Keychain authorization evidence; no system protections changed.

NSIS atomic cleanup still has file-path and temporary rollback-path length limits, including in the current algorithm. Bounded retries do not remove them or prove restoration after failure. The known v0 Session `summary requires notice form` limitation remains outside this patch.

## Verified installer sizes

All local installers match workflow checksums and GitHub digests. CNB's anonymous index matches all seven names, sizes and SHA-256 values, and seven anonymous download HEAD sizes match. This does not claim seven additional full CNB downloads.

| Installer | Bytes | MiB |
| --- | ---: | ---: |
| Windows x64 EXE | 456371310 | 435.2 |
| macOS arm64 DMG | 587317327 | 560.1 |
| macOS arm64 ZIP | 568067456 | 541.8 |
| macOS x64 DMG | 605234492 | 577.2 |
| macOS x64 ZIP | 585869541 | 558.7 |
| Linux x64 DEB | 460179836 | 438.9 |
| Linux x64 RPM | 408045049 | 389.1 |

Alternative-format total: `3671085011` bytes, versus the prior qualified set's `3668493135` bytes. Every like-for-like installer increased by less than `0.14%`. The total is not one user's download or the installed footprint. Exact paths, checksums and comparison: `.artifacts/release-notes/odsh-v0.2.1-rc.2.1-publication-review.md`.

## Publication state

- GitHub: [odsh-v0.2.1-rc.2.1](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.2.1-rc.2.1) is public, non-prerelease and Latest, published `2026-10-20T20:47:12Z`. Tag identity, eight asset sizes/digests and bilingual body match the reviewed local set.
- GitHub contains seven installers plus `SHA256SUMS`; its two generated source archives make ten displayed entries. Python and Office are embedded resources, not extra assets.
- CNB: release-triggered [39494951563](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/39494951563) succeeded. The [matching Release](https://cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/tag/odsh-v0.2.1-rc.2.1) is public with seven installers; no duplicate manual sync was dispatched.
- Anonymous index: revision `206`, generated `2026-10-20T20:47:39.588Z`, expires `2026-10-21T02:47:39.588Z`. Exact tag/version, non-withdrawn state, all indexed names/sizes/SHA-256 values and seven download HEAD sizes passed `verify-cnb-desktop-release.mjs`.
- Local handoff: `<primary-checkout>/release/0.2.1-rc.2.1/`, exactly seven installers and `SHA256SUMS`, directory-read-only. Checksums, ZIP payloads and DMG structures passed.
- The user explicitly authorized commits, pushes, GitHub publication and CNB synchronization without another confirmation for this release.

## Recording a completed release

After both destinations pass verification, replace this historical record with observed source/tag identity, accepted runs, platform qualification and limitations, shared plugin snapshot, download route/speeds, exact local set, installer sizes, GitHub state and CNB sync/index facts. Keep partial publication explicit until both pass. Later documentation commits never move the release tag or replace accepted installers.
