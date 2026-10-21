# Current desktop release state

This historical record describes the most recently completed release, not a new cycle's ledger. New cycles use the release Doctor's machine-readable plan under the Git common directory; its sibling Markdown is a readable snapshot.

## Version lock and source

- Desktop version: `0.2.1-rc.2.2`; core baseline: `dsh-v0.2.1-rc.2`.
- Tag: `odsh-v0.2.1-rc.2.2`; title: `v0.2.1-rc.2.2`.
- Release branch: `release/0.2.1-rc.2.2`; packaging branch: `fix/windows-packaging-0.2.1-rc.2.2`.
- Preserve this identity until the user explicitly changes the version. Retry, rebuild, synchronization, packaging and publication requests preserve the lock.
- The immutable tag matches all three accepted runs; the Doctor plan records the full source SHA. Master, release and packaging branches matched that source before publication and were pushed. Later README and historical-record commits do not move the tag or installers.
- Previous public Release: `odsh-v0.2.1-rc.2.1`; eight commits through the accepted source.
- Bilingual notes: `.artifacts/release-notes/odsh-v0.2.1-rc.2.2.md`; validation passed and the published GitHub body matches exactly.

The common logical bundled-plugin snapshot is `227152f2d5423d364f4266beffcb1c10de6f748b05108d4ffef346efd2a8fc4a`. It updates `@xmanrui/dsh-im` from `5.3.0` to `5.4.0`; the other fourteen bundled records are unchanged. Python and Office retain their embedded deployment policy.

## Network and platform qualification

Observed `2026-10-21`: GitHub API and official npm connectivity passed through the macOS system proxy at `127.0.0.1:7890`. Actual-artifact download minima were Windows `5.85`, macOS arm64 `6.04`, macOS x64 `2.97`, and Linux `5.88 MiB/s`, above the unchanged `1.0 MiB/s` floor. No low-speed stop occurred. One GitHub API TLS interruption was recovered by resuming only downloads; completed builds and verified archives were retained.

| Platform | Accepted run | Qualification |
| --- | --- | --- |
| Windows x64 | [39578996813](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/39578996813) | native preflight, fresh installation and six real alpha.2 upgrade scenarios passed: standard/admin users, same/changed directories and interactive installation; long-path and persistent-lock restoration checks passed |
| macOS arm64/x64 | [39582787087](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/39582787087) | both final DMG/ZIP sets passed installed-resource, Helper-layout, deep-signature and native Electron initialization checks |
| Linux x64 | [39582862658](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/39582862658) | DEB/RPM builds and resources-only qualification passed; GUI startup in a real desktop session remains unverified |

Windows injected a 261-character file and 281-character empty-directory path into the real old installation. Persistent locking returned failure while preserving old-state and boundary-file evidence; subsequent upgrade succeeded. The all-users changed-directory scenario used a 150-character private TEMP path. The fresh lane also exercised the new candidate's own upgrade and uninstall. Evidence remains in the accepted run's qualification artifacts and local `.artifacts/rc222-windows-*` directories; these runner results do not cover all Windows versions or physical machines.

The downloaded arm64 ZIP additionally passed two complete local launches using new Chinese/space paths, empty configuration and Electron's test-only mock Keychain. First readiness took `43181 ms` with Profile deployment; second took `5015 ms` without redeployment. Both recorded Harness/client/event-dispatch readiness, expected anonymous HTTP 401, fifteen seconds of liveness, exit 0, absent PID and closed ports after stopping. An initial restricted launch aborted before readiness; the unchanged test passed in the permitted native environment. Evidence: `.artifacts/0.2.1-rc.2.2-packaged-startup.json`; the restricted failure is retained separately. This is not manual GUI or real Keychain authorization evidence; no system protections changed.

Long-path-aware Windows staging replaces recursive NSIS payload cleanup. Restoration conflicts and interrupted transactions stop and preserve recovery evidence; restored files do not establish that every legacy uninstaller registration side effect was reversed. The known v0 Session `summary requires notice form` limitation remains outside this patch.

## Verified installer sizes

All local installers match workflow checksums and GitHub digests. CNB's anonymous index matches all seven names, sizes and SHA-256 values, and seven anonymous download HEAD sizes match. This does not claim seven additional full CNB downloads.

| Installer | Bytes | MiB |
| --- | ---: | ---: |
| Windows x64 EXE | 456496680 | 435.3 |
| macOS arm64 DMG | 587563890 | 560.3 |
| macOS arm64 ZIP | 568286785 | 542.0 |
| macOS x64 DMG | 605392213 | 577.3 |
| macOS x64 ZIP | 586091492 | 558.9 |
| Linux x64 DEB | 460384632 | 439.1 |
| Linux x64 RPM | 408234677 | 389.3 |

Alternative-format total: `3672450369` bytes, versus the prior qualified set's `3671085011` bytes. Every like-for-like installer increased by less than `0.05%`. The total is not one user's download or the installed footprint. Exact paths, checksums and comparison: `.artifacts/release-notes/odsh-v0.2.1-rc.2.2-publication-review.md`.

## Publication state

- GitHub: [odsh-v0.2.1-rc.2.2](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.2.1-rc.2.2) is public, non-prerelease and Latest, published `2026-10-21T11:06:03Z`. Tag identity, eight asset sizes/digests and bilingual body match the reviewed local set.
- GitHub contains seven installers plus `SHA256SUMS`; its two generated source archives make ten displayed entries. Python and Office are embedded resources, not extra assets.
- CNB: release-triggered [39589437691](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/39589437691) succeeded. The [matching Release](https://cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/tag/odsh-v0.2.1-rc.2.2) is public with seven installers; no duplicate manual sync was dispatched.
- Anonymous index: revision `210`, generated `2026-10-21T11:06:27.449Z`, expires `2026-10-21T17:06:27.449Z`. Exact tag/version, non-withdrawn state, all indexed names/sizes/SHA-256 values and seven download HEAD sizes passed `verify-cnb-desktop-release.mjs`.
- Local handoff: `<primary-checkout>/release/0.2.1-rc.2.2/`, exactly seven installers and `SHA256SUMS`, directory-read-only. Checksums, ZIP payloads and DMG structures passed.
- The user explicitly authorized commits, pushes, GitHub publication and CNB synchronization without another confirmation for this release.

## Recording a completed release

After both destinations pass verification, replace this historical record with observed source/tag identity, accepted runs, platform qualification and limitations, shared plugin snapshot, download route/speeds, exact local set, installer sizes, GitHub state and CNB sync/index facts. Keep partial publication explicit until both pass. Later documentation commits never move the release tag or replace accepted installers.
