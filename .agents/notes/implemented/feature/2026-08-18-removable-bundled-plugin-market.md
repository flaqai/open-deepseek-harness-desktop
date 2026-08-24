# Agent Note: Removable bundled preset plugins

Status: implemented

English | [中文](2026-08-18-removable-bundled-plugin-market.zh.md)

## Problem

Desktop packages should provide selected Web plugins offline while keeping each one as an ordinary profile dependency that the user can remove and later update. Large or product-specific integrations should not delay startup or install without an explicit user action. Core Cordis bundle entries would make launches restore removed plugins, while installing every carried archive as a `file:` dependency hides registry identity from update tooling.

## Decision

Electron resources ship pinned tarballs and SHA-512 integrity for `dshmarket@1.19.0`, `@xmanrui/dsh-im@1.0.2`, `dsh-skill-picker@0.2.0`, `dsh-font@1.1.0`, `dsh-pocket@1.12.3`, and `dsh-better-sidebar@0.15.2`. The target-specific packaging step also adds official `@deepseek-ai/dsh-subagent-codex@0.1.0-rc.8` with `@openai/codex@0.147.0` and one native payload. Manifest schema 2 marks each entry as `startup` or `manual` and optionally provides an exact registry or pinned Git spec.

Packaged startup processes only the five startup entries in manifest order. It prefers the exact registry or Git identity with packaged Node and pnpm so ordinary plugin update tooling can recognize the dependency; an unavailable network or registry falls back to the verified local archive. Success, or an existing dependency with the same package name, writes that plugin's durable seed marker without replacing an installed version. A failed entry writes a diagnostic and does not prevent the remaining startup entries from seeding.

Better Sidebar is manual from the existing discovery action, and Codex is manual from External Tools. The renderer receives no generic installer: a sandboxed preload forwards only exact profile and package-spec pairs found in manual manifest entries. Other package requests continue through the guarded Host Remote. One manual target has at most one active package-manager writer, job polling retains bounded diagnostics, and explicit installation may replace an earlier uninstall tombstone.

Each marker survives profile removal, so future launches do not reinstall that plugin. Windows packages run the embedded `pnpm.mjs` through their official Node executable with an argument vector and no shell interpolation. The Host exposes exact-package removal, while startup and manual entries remain ordinary dependencies removable through the standard profile plugin manager.

## Alternatives considered

- **Core Web bundle:** rejected because it would not be independently removable.
- **Seed whenever missing:** rejected because it would undo a user uninstall.
- **Install every carried archive during startup:** rejected because Better Sidebar and Codex are large, optional capabilities whose installation must be user initiated.
- **Always install from a local archive:** rejected because `file:` identity prevents the market from treating community presets like ordinary updateable registry or Git dependencies.
- **Rewrite the lockfile after local installation:** rejected because offline registry metadata is not guaranteed and manual lockfile mutation would bypass pnpm's resolution contract.
- **Plugin self-uninstall:** rejected because a plugin cannot reliably remove its own active package and bundle.
- **System Node and pnpm on Windows:** rejected because packages must be self-contained.

## Consequences

macOS, Windows, and Linux artifacts carry six audited community archives plus one target-specific Codex archive. First launch may run one package-manager operation per missing startup seed and may reach the registry before using the offline fallback. Better Sidebar and Codex consume disk space in the installer but no profile installation time until requested. Tests pin the complete policy manifest, archive integrity, adoption, tombstone replacement, single-flight manual jobs, bounded diagnostics, and renderer fallback. The installed Windows smoke requires all five startup dependencies, bundle entries, profile lockfile, and markers, while requiring both manual archives to remain absent from the profile before user action.
