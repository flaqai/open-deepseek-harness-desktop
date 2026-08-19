# Agent Note: Removable bundled preset plugins

Status: implemented

English | [中文](2026-08-18-removable-bundled-plugin-market.zh.md)

## Problem

Desktop packages should provide the selected default Web plugins offline while keeping each one as an ordinary profile dependency that the user can remove. Core Cordis bundle entries would make launches restore them.

## Decision

Electron resources ship pinned tarballs and SHA-512 integrity for `dshmarket@1.12.1`, `@xmanrui/dsh-im@0.11.0`, and `dsh-skill-picker@0.2.0`. First packaged launch verifies and copies each missing seed into DSH home, then invokes the existing CLI installer with packaged Node and pnpm. Success, or an existing dependency with the same package name, writes that plugin's durable seed marker without replacing an installed version.

Each marker survives profile removal, so future launches do not reinstall that plugin. A failed seed writes no marker and does not prevent the remaining entries from seeding. Windows packages include pnpm and narrow Electron-as-Node command shims. The Host exposes exact-package `startUninstall`; the inventory React component receives it through slot injection and shows the dedicated self-removal action only for `dshmarket`. All three remain ordinary dependencies removable through the standard profile plugin manager.

## Alternatives considered

- **Core Web bundle:** rejected because it would not be independently removable.
- **Seed whenever missing:** rejected because it would undo a user uninstall.
- **Plugin self-uninstall:** rejected because a plugin cannot reliably remove its own active package and bundle.
- **System Node and pnpm on Windows:** rejected because packages must be self-contained.

## Consequences

macOS, Windows, and Linux artifacts carry three audited archives. First launch may run one local package-manager operation per missing seed. The market's Settings action and ordinary CLI removals use the same profile path; restart activates removal. Tests pin the complete manifest, archive integrity, adoption, marker behavior, Windows shims, Host removal, and confirmation UI.
