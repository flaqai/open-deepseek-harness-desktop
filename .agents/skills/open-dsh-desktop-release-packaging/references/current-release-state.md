# Current desktop release state

This historical record describes the completed release. New cycles use the release Doctor plan under the Git common directory.

## Version lock and source

- Desktop version: `0.2.2-alpha.2`; integrated core baseline: `dsh-v0.2.2-alpha.2`, plus the selected rc.5 reasoning-display backport.
- Published tag: `odsh-v0.2.2-alpha.2`; title: `v0.2.2-alpha.2`; state: normal Release, Latest, eligible for CNB.
- Qualified immutable source: the target of `odsh-v0.2.2-alpha.2`; the complete commit ID is retained in the release Doctor plan and local GitHub publication evidence.
- Packaging branch: `fix/windows-packaging-0.2.2-alpha.2`. Source fixes were pushed and master contains the qualified source. The plan names `release/0.2.2-alpha.2`; do not infer that this named branch was created or pushed without checking.
- Preserve this version until the user explicitly changes it. Retry, rebuild, synchronization, packaging and publication requests retain the version lock.
- Previous actual public Release: `odsh-v0.2.1-rc.3`.
- Bilingual notes: `.artifacts/release-notes/odsh-v0.2.2-alpha.2.md`; validation passed against the previous actual public tag and full source SHA. Published body matches the reviewed notes after trailing-newline normalization.

The common accepted bundled-plugin snapshot digest is `f39597b47eb4a98bdce4b434e9ea1cbe9298eaaa0a52cdc24e2a331d6a2c6ee7`, verified by the final download helper across all accepted native runs. Accepted registry-backed records include dshmarket `1.73.8`, @xmanrui/dsh-im `5.9.1`, dsh-better-sidebar `0.24.1`, dsh-pocket `2.12.0`, @agents-anywhere/dsh-bridge-next `2.0.2`, @ychris12138/dsh-usage-stats `0.3.7`, dsh-mermaid `0.4.4`, dsh-whale-widget `0.4.2`, @weibaohui/skills-management `0.9.3`, @dsh-plugins/mcp-panel `0.1.0`, dsh-font `1.1.0`, and five diagnostic-lab archives `1.0.0`. This lists the accepted set, not a guessed version delta. Python and Office retain the embedded native-resource deployment policy.

## Network and platform qualification

Observed November 2–3, 2026: CLI tools explicitly adopted the macOS system proxy at `127.0.0.1:7890`; GitHub API and official npm connectivity passed. Initial artifact speed samples were `0.87 MiB/s` minimum (`1.31` average) and `0.46 MiB/s` minimum (`0.99` average), below the default `1.0 MiB/s` floor. The user explicitly authorized proceeding at the current speed for this release; the active plan uses floor `0` for this cycle only. Actual Windows transfer subsequently reached approximately `2.5–3.2 MiB/s`. Do not describe disabled later sampling as a passed 1.0 MiB/s speed gate. Download logs retain actual progress and resumable-operation evidence.

| Platform | Accepted run | Qualification |
| --- | --- | --- |
| Windows x64 | [41436626720](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/41436626720) | Native preflight and all seven installed scenarios passed: fresh plus six real public alpha.2 upgrades covering current-user/all-users, same/changed directories and interactive installs. Installed first start, restart, CLI, plugin maintenance, persistent-lock and uninstall checks passed. Final ZIP Chinese/space-path extraction and native/main-import/managed-CLI probes passed. |
| macOS arm64/x64 | [41443002523](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/41443002523) | Final DMG/ZIP resource inventory, Helper layout, deep signature structure and native Electron startup passed on each architecture's runner. Arm64 initially suffered hosted-runner capacity cancellations; successful x64 results were retained, and only arm64 was retried. |
| Linux x64 | [41443080725](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/41443080725) | DEB/RPM builds and resource-only qualification passed. Real Linux GUI startup remains unverified. |

Every accepted run identifies the same source SHA above and uses the common plugin snapshot. Windows fixes normalize NSIS SHELL_CONTEXT into a concrete HKCU/HKLM registry root and preserve complete appended installer diagnostics; earlier failed candidates are not release inputs.

The final downloaded arm64 ZIP additionally passed full local isolated startup in a Chinese/space path. Evidence: `.artifacts/release-validation/0.2.2-alpha.2/中文 启动验证/smoke-jBScCi/report.json`. A fresh private DSH_HOME and test-only app-data root were used; no real NAS credential storage or real account credentials were needed. The native owner was stopped during candidate copying before activation, then killed; its exit was confirmed before recovery. One completed code file preserved inode, size and SHA-256 through recovery and activation. Recovery reached both client/event-dispatch readiness markers in `18088 ms`, returned authenticated HTTP 200, survived 10 seconds and exited 0. Second launch reached readiness in `5018 ms`, performed zero Profile deployments, returned authenticated HTTP 200, survived 10 seconds and exited 0. This is a sampled reuse test, not an exhaustive resource-reuse or live-owner-contention test. Offline plugin maintenance uses accepted native-workflow evidence.

No manual GUI/mobile assessment, Apple notarization, real Keychain authorization or additional Windows/Linux physical-machine qualification is claimed. Known v0 Session `summary requires notice form` remains outside this release's repair scope.

## Verified installer sizes

The exact read-only local handoff is `release/0.2.2-alpha.2/`: eight installers plus `SHA256SUMS`, with no extra files. All eight local SHA-256 values match accepted workflow checksums; ZIP integrity and final-directory contract checks passed. GitHub remote asset verification and CNB index/download verification are **pending**.

| Installer | Bytes | MiB |
| --- | ---: | ---: |
| `DeepSeek-Harness-linux-x64.deb` | 467942328 | 446.3 |
| `DeepSeek-Harness-linux-x64.rpm` | 413181933 | 394.0 |
| `DeepSeek-Harness-macos-arm64.dmg` | 597210991 | 569.5 |
| `DeepSeek-Harness-macos-arm64.zip` | 577404541 | 550.7 |
| `DeepSeek-Harness-macos-x64.dmg` | 615257211 | 586.8 |
| `DeepSeek-Harness-macos-x64.zip` | 595240103 | 567.7 |
| `DeepSeek-Harness-windows-x64.exe` | 462259357 | 440.8 |
| `DeepSeek-Harness-windows-x64.zip` | 561800787 | 535.8 |

Alternative-format total: `4290297251` bytes (`4091.5 MiB`). This includes mutually alternative formats and architectures; it is not one user's download or the installed footprint. Windows ZIP is an additional format absent from the previous seven-installer release; do not interpret total-size differences as a like-for-like growth measurement.

## Verified publication

- GitHub: https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.2.2-alpha.2 . Published `2026-11-03T03:55:02Z`, non-prerelease and Latest. Tag target is the qualified immutable source above. All nine project assets match local sizes and SHA-256; published body and title match the reviewed notes. Generated source ZIP/TAR are separate page entries.
- CNB: https://cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/tag/odsh-v0.2.2-alpha.2 . Release-triggered sync [41575017080](https://github.com/flaqai/open-deepseek-harness-desktop/actions/runs/41575017080) succeeded without duplicate dispatch.
- Anonymous index revision `272`, generated `2026-11-03T03:55:22.958Z`, expires `2026-11-03T09:55:22.958Z`. The verifier confirmed exact version/tag, non-withdrawn state, eight filenames/sizes/SHA-256 values and anonymous download URL sizes. This is not eight full CNB downloads. Evidence: `.artifacts/release-validation/0.2.2-alpha.2/cnb-verification.json` (text report) and `github-published.json`.
- Upload recovery: arm64 ZIP received HTTP 408; the matching Draft resumed with its first three verified assets preserved. All remaining uploads and final public identity checks passed. No assets were clobbered.
- User authorization covers this normal GitHub Release and CNB synchronization. Subsequent documentation commits never move the qualified tag or replace accepted installers.

## Validation artifact retention

Inventory and completed cleanup evidence: `.artifacts/release-validation/0.2.2-alpha.2/cleanup-inventory.json` and `cleanup-report.json`. Before deleting the exact duplicate `final arm64` extraction, all eight retained installer checksums were rechecked; its app.asar matched the retained verified ZIP, and an approved native PID-only scan found no related live processes. The duplicate extraction was removed; observed free space increased from `97894400000` to `99532800000` bytes (delta `1638400000`). Filesystem deltas may reflect APFS sharing and concurrent activity.

The successful `smoke-jBScCi` environment is the one retained latest reproduction environment. Failed helper environments `smoke-qANpBE` and `smoke-W1ykN6` retain their reports/logs and expire at `2026-11-10T02:41:30Z` unless an investigation pins them. Download staging was already absent after atomic handoff activation. Final installers/checksums, qualification reports, necessary failure logs, helper and release identity records remain retained. No tracked source was changed by cleanup.

## Recording a completed release

Replace this historical record only after both destinations pass identity verification. Preserve accepted source, shared snapshot, platform limitations and local evidence; later documentation commits never move a published tag.
