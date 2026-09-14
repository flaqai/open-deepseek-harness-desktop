# Agent Note: Community 0.1.5-alpha.1 runtime and connection integration

Status: implemented

English | [中文](2026-09-09-community-alpha15-runtime-and-connection.zh.md)

## Problem

Upstream `0.1.5-alpha.1` separates the desktop carrier from the Web server and advances Session storage to V3. Community Desktop still serves the same `web` Profile to Electron and the local browser. Copying the upstream desktop application would change that sharing model and bypass community recovery and installer downloads. An unchanged dedicated RPC adapter also reads a service no longer injected by Connection, preventing `dsh-pocket` from loading.

## Decision

The integration target is `dsh-v0.1.5-rc.2` at `fb2c4b9e698e30edb738bca4cf0618587db7d203`. The external Harness runtime is Node `24.17.0`; Electron remains `43.2.0` and pnpm remains `11.7.0`. The macOS installer requires `13.5`, matching the external Node binary's deployment requirement. Updating the external runtime does not change Electron's embedded Node.

Community Desktop retains the loopback `dsh web` launcher, shared Profile, browser authentication, custom desktop bridge, and GitHub installer downloader. Upstream's standalone desktop update coordinator and cloud release scripts are not community release entry points. The official right Sidebar and V3 migration chain remain upstream-owned.

Dedicated Connection RPC registrations reserve their channel names in the calling plugin's effect. Their physical routes use a child context explicitly injecting `webServer`; the Web Profile therefore injects both `webRuntime` and `webServer` into Connection, while consumers need only inject `connection`. Disposing the caller removes the route and reservation. Missing Web transport leaves a pending registration rather than forcing the neutral Connection service to depend on HTTP. Existing authentication and Host/Origin checks still protect every dedicated route.

Diagnostic Profile readiness proves only that the installation-owned recovery interface runs. It neither creates an active-Profile bootable snapshot nor commits a pending snapshot restore. A restore that reaches only diagnostic mode follows the existing failed-start rollback path.

Session migration retains V0 → V1 → V2 → V3 and the narrowly proven failed-empty-tool repair. The V3 reader validates the named `external-tools/resolved` audit extension; unknown events are not admitted generically. Source generations stay unchanged, and plugin snapshots cannot undo session-format migration.

Desktop-hosted plugin mutations prepare and verify a candidate under the active home's transaction directory while keeping the running Profile unchanged. The same mutation token transfers ownership from CLI to Desktop; activation retains the complete previous dependency directory until ordinary readiness commits the transaction. Failure restores those dependencies and managed metadata, not sessions or user settings. Startup recovery settles the journal before inspecting the Profile. The isolated interruption exercise uses the same activation and recovery commands.

The pnpm Node worker registers its PID before package code executes and strips the lease capability from lifecycle-script environments. Either a live controller or a live worker prevents reclamation. Candidate preparation preserves literal registry, Git, archive and local specs; relative sources that escape the candidate and workspace sources fail explicitly. Startup seeding, manual bundled installs, imported restoration, recovery removal, and descendant runtime plugin commands use the same candidate activation. Candidate-generated pnpm locators move back to the active Profile without changing manifest specifiers or integrity, and bundled archives and seed markers activate with the dependency tree. A new successful bootable point demotes, rather than deletes, its predecessor so a pre-change point remains recoverable.

Plugin activation waits for the actual Harness launch before starting its 180-second server budget. A published server URL starts a separate 60-second window for both renderer readiness markers. Repeated start or URL signals do not extend either window. Cold disk reads and plugin loading therefore do not consume a 30-second renderer budget before the server exists. Timeout rollback records its failing phase; it preserves the previous dependency tree and does not commit unverified seed markers. Entries deferred by the startup installation budget or failure cooldown remain visible in diagnostics with a retry action, and the startup log reports preparation separately from activation.

First preparation persists `bundled-plugins/first-start.pending` before creating the Profile. Native builds retain a checksummed preset template, including dependency files but excluding stores and user data. Fresh deployment uses one candidate and read-only Doctor, with no pnpm installation. A safety snapshot can represent an absent Profile; rollback removes newly activated managed state. Interrupted copying resumes only with a matching fingerprint and a dead prior producer, reusing verified files and rerunning validation. Explicit build denials or incompatible templates use a bounded local-archive batch; corrupted templates fail closed. No partial candidate may open the client. The pending file is removed only after ordinary readiness, commit, and lease release. Reused Profiles retain incremental policy. Deployment counts are throttled for IPC; interrupted partials stay outside the activated dependency tree. Final package inventory checks run after copying and signing. Regression tests cover absent-Profile rollback, relocation, interruption, corruption, build rules and completion callback ordering.

## Alternatives considered

**Replace community launch with upstream's desktop Profile.** Rejected because it separates plugin state and removes the shared local browser surface.

**Disable the phone plugin or restore an unconditional Web dependency.** Rejected because explicit optional transport injection preserves both the consumer and upstream's carrier-neutral service.

**Treat every ready interface as a healthy active Profile.** Rejected because recovery readiness can otherwise bless the plugin state that just failed.

**Upgrade Electron with external Node.** Not selected: the runtimes are independent, and the user retained Electron `43.2.0`.

## Consequences

Runtime, migration, and transport checks do not establish installation compatibility on untested operating systems. Windows, Linux, macOS x64, signed installer behavior, and online compatibility-manifest publication retain separate validation or approval requirements. Unconnected upstream standalone desktop modules are excluded from the community application and its copied build outputs.

The [earlier migration decision](2026-09-08-community-upstream-alpha2-session-migration.md) retains its failed-tool repair rationale. The [community build decision](2026-08-20-community-desktop-rc8-integration.md) retains build-profile and branding ownership; this note owns the newer runtime and transport choices.
