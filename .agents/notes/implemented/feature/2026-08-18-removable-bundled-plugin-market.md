# Agent Note: Removable bundled plugin market

Status: implemented

English | [中文](2026-08-18-removable-bundled-plugin-market.zh.md)

## Problem

Desktop packages should provide the plugin market offline while keeping it as an ordinary profile dependency that the user can remove. A core Cordis bundle entry would make launches restore it.

## Decision

Electron resources ship the pinned `dshmarket@1.12.1` tarball and SHA-512 integrity. First packaged launch verifies and copies it into DSH home, then invokes the existing CLI installer with packaged Node and pnpm. Success, or an existing market dependency, writes a durable seed marker.

The marker survives profile removal, so future launches do not reinstall the plugin. Failed seeds write no marker. Windows packages include pnpm and narrow Electron-as-Node command shims. The Host exposes exact-package `startUninstall`; the inventory React component receives it through slot injection and shows it only for `dshmarket`.

## Alternatives considered

- **Core Web bundle:** rejected because it would not be independently removable.
- **Seed whenever missing:** rejected because it would undo a user uninstall.
- **Market self-uninstall:** rejected because the market cannot uninstall itself.
- **System Node and pnpm on Windows:** rejected because packages must be self-contained.

## Consequences

macOS and Windows artifacts gain one audited archive. First launch may run one local package-manager operation. Settings removes the market through the same profile path as the CLI; restart activates removal. Tests pin integrity, adoption, marker behavior, Windows shims, Host removal, and confirmation UI.
