# Agent Note: Community desktop integration on the rc.8 client architecture

Status: implemented

English | [中文](2026-08-20-community-desktop-rc8-integration.zh.md)

## Problem

The community desktop distribution carries settings, onboarding, themes, backgrounds, bundled plugins, runtime isolation, and packaging behavior beyond the upstream Web artifact. Upstream rc.8 introduces dynamic client packages, build-environment records, generic brand slots, shared settings schema operations, attachments and references, and a Web launcher that opens a browser by default. Copying old base components forward would bypass those contracts, while building the Electron package from an unprofiled client could mix official and community behavior or package stale browser artifacts.

## Decision

The repository retains upstream history through a merge and treats rc.8 as the architecture baseline. A complete `community-desktop` client build profile supplies the short Git revision, the existing application title, and `DSH_CLIENT_BUILD_PROFILE=community-desktop` to both Vite and dynamic client bundles before the Electron main process is built. The generic upstream shell remains unchanged. A separate community brand package occupies the sidebar and Hero brand slots only for that profile; the official brand package remains limited to `official` builds.

The Electron app, desktop settings package, and community brand package remain private workspace members. Installer builds consume them, but the official `dsh` npm release family excludes them, so their repository identity is not rewritten to imply that DeepSeek publishes the community distribution.

Electron launches the bundled Harness with `web --host 127.0.0.1 --port 0 --no-open`, so only the hardened embedded window owns the local Web surface. The desktop version follows the rc.8 baseline while application identity, data paths, runtime staging, packaged pnpm, bundled-plugin seeding, themes, backgrounds, onboarding, and desktop settings remain community-owned extensions. Models settings and onboarding share rc.8's settings schema operations and mirrors rather than maintaining a second write path.

Generated configuration catalogs, client slot catalogs, translation pairing records, and the workspace lockfile are rebuilt from the merged source. Upstream schema 17 and its public request behavior are accepted without a private SQLite migration or compatibility protocol.

## Alternatives considered

**Cherry-pick selected rc.8 features.** This would leave the client package graph, settings mirrors, generated catalogs, and runtime closure on mutually incompatible generations and make later upstream merges harder.

**Enable the official build profile for desktop packages.** That would misidentify a community distribution and allow official-only occupants to become part of its artifact contract.

**Keep direct edits in upstream shell components.** Generic slots now provide an owned extension seam; direct edits would recreate recurring merge conflicts and couple community branding to the conversation and sidebar packages.

**Let the rc.8 Web launcher open a browser.** Electron already renders the loopback origin. A second browser surface is surprising, duplicates startup UI, and is unnecessary for the desktop product.

## Consequences

Community desktop builds now receive the same recorded and digest-bound client environment as upstream artifacts, while official and community branding remain mutually exclusive by profile. Settings and onboarding follow one schema/mirror path, and rc.8 attachments, references, persistent PowerShell, subagents, and other new packages enter the normal workspace and staging closure.

The distribution must run the complete community client build before desktop compilation; partial client builds intentionally invalidate the recorded artifact digest. Windows installation smoke tests still require a Windows runner because Node, pnpm, NSIS installation, paths with spaces or Chinese characters, and bundled-plugin seeding must be exercised in their final platform layout. No merge, publication, or release action is implied by a successful local build.
