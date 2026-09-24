# Agent Note: Imported plugin source checks and local recovery

Status: implemented

English | [中文](2026-08-26-imported-plugin-source-recovery.zh.md)

## Problem

The independent desktop data import retained portable plugin declarations but could not tell users whether an npm or Git source still existed before they selected it. Local, credentialed, and unrecognized declarations were correctly blocked, but there was no controlled replacement path when the original source was gone. Copying an official Profile's `node_modules` would carry platform-specific executable state and recreate the dependency-identity conflicts that the independent home is designed to prevent.

## Decision

**Availability is transient and conservatively classified.** Opening the restore presentation starts at most three embedded-pnpm resolutions at once in disposable directories with lifecycle scripts disabled and a ten-second per-item timeout. A successful resolution is available. Confirmed registry absence, missing versions, repositories, or Git refs are unavailable. Timeouts, offline failures, authentication, authorization, and rate limits are unknown, so a temporary service failure never becomes a claim that a plugin does not exist. Matching installed or bundled dependencies remain provided and skip resolution. These statuses and bounded diagnostics exist only in the Electron process; the version-one restore manifest does not change.

**Online selection follows availability.** Available ordinary plugins are selected by default. Unavailable entries cannot enter the online installer. Unknown entries remain unselected but can be explicitly selected for an attempted online restore. Local paths, credential-bearing addresses, and invalid declarations never execute directly. External tool packages retain their existing online-only installation flow and cannot be replaced by a local archive.

**Local recovery accepts only a newly validated package.** The renderer submits an opaque restore id and asks Electron to open either a directory or `.tgz` picker. Directory packages must have the exact expected package name and are packed by the embedded pnpm with lifecycle scripts disabled through a package-manager configuration option. Archives are staged into a disposable directory; their size is limited to 200 MiB, every archive path is checked for traversal or absolute paths, and only a regular `package/package.json` up to 1 MiB is read. The package name must match exactly. A known local version that differs from the imported declaration requires a second user confirmation.

**Installation still uses the standard plugin pipeline.** After validation, Electron passes the staged archive to `dsh plugin --profile web add`, preserving build approval, dependency diagnostics, and shared-host repair. Online selections install in one batched CLI invocation within a managed candidate and activate Harness once after all selected packages finish; any package or activation failure rolls back the whole selected batch and reports every selected entry as failed. A local archive uses the same candidate path. Success is recorded only after candidate activation, so an already activated restore does not request another restart. Temporary files are removed after success, failure, or cancellation, and the user's selected absolute path is never stored in the restore manifest. Installation failures remain bounded, persisted, and retryable. The official Profile's `node_modules` is never scanned, copied, or adopted, even when a user points the directory picker at one of its package folders.

**Source builds provide renderer-only failure fixtures.** The restore presentation exposes buttons for checking, offline, timeout, authentication, rate-limit, and confirmed-missing states only when the source-mode preload capability is present. A fixture derives a temporary view from the latest real snapshot and never invokes the source checker or changes the manifest. Install, local-source, recheck, dismiss, and restart side effects stay disabled until the developer restores the real result; packaged applications never receive this capability.

**Recovery owns a dedicated Desktop Settings section.** When Electron exposes the bounded restore bridge, `Plugin recovery` is registered as its own left-navigation page between External tools and Diagnostics; an ordinary `dsh web` client receives no meaningless desktop-migration entry. The former first-entry overlay and Plugins-list card are removed, so importing user data no longer interrupts entry into the client or mixes migration work with the live plugin inventory. The page remains available with a clear empty state when no restore manifest exists, and keeps completed, failed, and pending entries visible when one does.

## Alternatives considered

- **Copy the old installed package:** rejected because it transfers mutable and platform-specific executable state without replaying package-manager or supply-chain checks.
- **Treat every resolution failure as unavailable:** rejected because connectivity, credentials, and rate limits are temporary and do not prove source absence.
- **Persist availability:** rejected because it goes stale and would require a schema migration for data that is safe to recompute.
- **Fall back to direct official-home reuse:** rejected; this flow remains an independent-environment import and does not silently change its isolation model.

## Consequences

- Source checks can take time for large restore lists but never block Harness startup.
- Users can recover unpublished plugins from source or an archive without granting the renderer arbitrary filesystem access.
- A local package may intentionally differ from the imported declaration, but only after an explicit warning.
- Closing and reopening the restore page can repeat safe availability checks; no stale network conclusion becomes durable state.

Focused tests cover source classification, the concurrency bound, unknown-versus-unavailable selection, package identity, archive path safety, staged-file cleanup, local version confirmation, strict TypeScript, Desktop build, and the restore components.
