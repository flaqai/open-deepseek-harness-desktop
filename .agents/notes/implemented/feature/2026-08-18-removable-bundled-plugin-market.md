# Agent Note: Removable bundled preset plugins

Status: implemented

English | [中文](2026-08-18-removable-bundled-plugin-market.zh.md)

## Problem

Desktop packages should provide selected Web plugins offline while keeping each one as an ordinary profile dependency that the user can remove and later update. Product-specific external-tool integrations should not install without an explicit user action. Core Cordis bundle entries would make launches restore removed plugins, while installing every carried archive as a `file:` dependency hides registry identity from update tooling.

## Decision

Electron resources ship seven pinned startup tarballs with SHA-512 integrity. Before packaging, pnpm resolves every exact registry entry through its `latest` stable dist-tag at the canonical npm registry, downloads and verifies the returned tarball, and atomically replaces the snapshot. A fixed Git entry retains its reviewed commit and archive. GitHub packaging resolves one snapshot in a prerequisite job and gives those exact files to every platform job. Manifest schema 2 marks each entry as `startup`, `manual`, or `diagnostic` and retains the exact resolved registry or pinned Git spec for presentation and later explicit updates. Codex and Claude Code remain online-only external-tool installs.

Packaged startup processes all seven startup entries in manifest order and always gives pnpm the integrity-checked local archive path instead of the registry package spec. Startup preset installation therefore never resolves or downloads the plugin tarball itself; the Profile package manager still owns ordinary transitive dependency resolution and store reuse. A successful bundled installation writes a schema-3 durable marker with desktop ownership; adoption of an existing dependency records external ownership. When a later package contains a strictly newer preset, startup replaces an older desktop-owned archive. A schema-2 marker with a present dependency always receives one actual installed-version and ownership check, even when the marker claims the packaged version; it can replace a registry dependency only when the resolved version is lower than the packaged version. External or custom sources, equal or newer resolved versions, snapshot holds, and uninstall tombstones remain unchanged; startup never downgrades a plugin. A failed entry writes a diagnostic and does not prevent the remaining startup entries from seeding. Runtime preparation installs the same startup subset from the snapshot into a disposable profile; diagnostic entries remain integrity-checked without executing optional lifecycle code before an exercise requests installation.

Better Sidebar is a startup entry and is installed before Harness starts, just like the other presets. Its former automatic bottom-right post-entry overlay is no longer registered. The exact allowlisted deferred job, progress polling, retry, fixed-log and restart primitives remain available for explicit imported-plugin restore work, but do not trigger by themselves. Codex and Claude Code remain user initiated from External Tools. The renderer receives no generic installer: a sandboxed preload forwards only exact profile and package-spec pairs found in manual manifest entries. Other package requests continue through the guarded Host Remote. One target has at most one active package-manager writer and polling retains bounded diagnostics.

Each marker survives profile removal, so future launches do not reinstall that plugin. Windows packages run the embedded `pnpm.mjs` through their official Node executable with an argument vector and no shell interpolation. The Host exposes exact-package removal, while startup and manual entries remain ordinary dependencies removable through the standard profile plugin manager.

## Alternatives considered

- **Core Web bundle:** rejected because it would not be independently removable.
- **Seed whenever missing:** rejected because it would undo a user uninstall.
- **Defer Better Sidebar until the usable shell is visible:** rejected after implementation because shell timing and package-version drift could prevent the automatic job from appearing, and the extra restart made first-run behavior unpredictable. Better Sidebar now joins the deterministic startup presets; online-only external tools remain user initiated.
- **Resolve `latest` independently in each platform job:** rejected because one publication during the matrix run could produce platform installers with different plugin versions.
- **Resolve `latest` when the installed application starts:** rejected because first launch must remain offline and deterministic.
- **Prefer registry identity at startup with archive fallback:** rejected because even a best-effort registry request makes preset installation depend on network state and increases startup variance.
- **Rewrite the lockfile after local installation:** rejected because offline registry metadata is not guaranteed and manual lockfile mutation would bypass pnpm's resolution contract.
- **Plugin self-uninstall:** rejected because a plugin cannot reliably remove its own active package and bundle.
- **System Node and pnpm on Windows:** rejected because packages must be self-contained.

## Consequences

macOS, Windows, and Linux artifacts carry one shared resolved snapshot of seven audited startup archives and six diagnostic resources. Packaging requires npm registry access, but preset installation in the released application does not. A local packaging command refreshes registry-backed archives unless `DSH_BUNDLED_PLUGINS_REFRESH=0` requests verification of a pre-resolved snapshot. Better Sidebar adds its profile installation time before Harness startup; Codex and Claude Code consume none until requested. Tests cover stable-version rejection, archive integrity, atomic snapshot replacement, local-only installation, ownership-aware adoption and upgrade, downgrade and uninstall suppression, single-flight jobs, staged progress, bounded diagnostics, and renderer fallback. The installed Windows smoke requires all seven startup dependencies before artifact upload, while online-only external tools must remain absent before user action.
