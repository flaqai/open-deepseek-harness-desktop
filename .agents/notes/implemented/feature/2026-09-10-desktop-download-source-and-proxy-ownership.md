# Agent Note: Desktop download source and proxy ownership

Status: implemented

English | [中文](2026-09-10-desktop-download-source-and-proxy-ownership.zh.md)

## Problem

Application updates can require a network route that differs from model and agent traffic. Applying update credentials or proxy state to the main renderer would expose secrets and alter unrelated behavior. A domestic Release mirror also needs independent withdrawal and integrity metadata instead of a silent fallback from GitHub.

## Decision

Electron owns a versioned application-update policy under `userData`. The renderer can submit only a validated source and HTTP(S) proxy fields through a narrow bridge. Electron safe storage encrypts proxy passwords when available; otherwise they remain in process memory. Logs, exports, the browser client, `DSH_HOME`, and plugin snapshots do not receive those secrets.

Application updates select either the existing GitHub adapter or an independent CNB adapter for `hecoococ/open-deepseek-harness-desktop`. CNB accepts only a bounded, fresh anonymous index from its `/-/git/raw/` endpoint and exact repository asset URLs. The index carries a revision, two-hour expiry, withdrawal state, size, and SHA-256. The downloader rechecks the selected source before transfer and before opening, periodically checks CNB withdrawal during transfer, and never combines partial files across sources. GitHub retains its system-network and Asset API channels.

Desktop exposes an npm registry and proxy policy for package mutations that Desktop itself starts, including external-tool/provider installation and guarded Desktop plugin installation. New settings default to `npmmirror`; users can select the official npm registry or a custom registry. A legacy persisted "keep existing registry" choice migrates to `npmmirror`, while explicit official or custom choices remain unchanged. Private scopes, build denials, integrity checks, and exact-version requirements remain in force.

The official market still does not expose a host-managed network-policy capability for its own catalog, README, source-archive, or Git operations, so Desktop does not display the GitHub plugin-download controls. Those market operations retain their existing Profile, Git, and market network configuration. The bundled `dshmarket` archive is the unmodified package published by its upstream maintainer.

The CNB sync workflow mirrors one explicitly selected non-draft, non-prerelease GitHub Release with a valid `SHA256SUMS`; scheduled runs select only GitHub's current latest Release. It verifies bytes before upload, verifies anonymous CNB assets, and publishes the index last. Manual cleanup requires exact CNB tag names and cannot delete the selected target. The workflow remains disabled until maintainers configure both `CNB_SYNC_ENABLED=true` and `CNB_TOKEN`; credentials stay in CI secrets and never ship to clients.

## Alternatives considered

**Silently fail over between GitHub and CNB.** A mirror can lag or retain a withdrawn build. Explicit source selection keeps failure and trust decisions visible and forbids cross-source resume.

**Maintain a private market patch.** A downstream patch couples the market to one desktop distribution and requires a separate compatibility review for every market release. Host-managed plugin network policy belongs in a general upstream interface.

## Consequences

Users can tune application-update downloads and Desktop-managed npm package installs without changing model, MCP, market-owned GitHub, or Git SSH traffic. Custom authenticated proxies require system safe storage for persistence; unsupported systems keep passwords only until exit. Direct mode intentionally refuses fallback through an existing proxy.

The local update router belongs to the desktop lifecycle and closes during exit, restart, or data-directory changes. Market catalogs, READMEs, source archives, and Git operations continue to use their existing network configuration. CNB remains unavailable until its repository permits anonymous index and asset reads and maintainers enable the dormant synchronization workflow; connection tests report that state instead of falling back to GitHub.

Focused tests cover settings validation and secret redaction, authenticated CONNECT, CNB index validation, independent download and revalidation, long translations, and the official market archive integrity. Windows proxy authentication and the public CNB deployment remain native or external verification items.
