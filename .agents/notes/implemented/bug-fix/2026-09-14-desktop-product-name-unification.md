# Agent Note: Unify the desktop product name without changing application identity

Status: implemented

English | [中文](2026-09-14-desktop-product-name-unification.zh.md)

## Problem

Source launches, packaged executables, menus, title bars, shortcuts, and fresh installation directories used three different names: `DeepSeek Harness`, `Open DSH Desktop`, and `deepseek-harness`. Users could therefore see different application or process identities depending on how Desktop was launched or installed.

## Decision

`Open DeepSeek Harness Desktop` is the canonical user-visible product name. Electron Builder uses it as `productName` on macOS, Windows, and Linux. The runtime application name, default window title, native menu copy, custom title bar, loading-page brand, Windows shortcut creation, and package smoke expectations use the same full name. Generic renderer titles such as `DeepSeek Harness` are normalized to the desktop product name, while conversation-specific page titles remain unchanged.

The macOS source launcher still copies and ad-hoc signs the project-local Electron bundle. The copied `.app`, Bundle display name, and runtime process title use the canonical product name. The internal development executable remains `Electron` so Electron preserves its `process.defaultApp` and `app.isPackaged` development-mode classification; renaming it makes a source launch incorrectly enter packaged-runtime extraction. The cache key includes the product identity so an older ready wrapper cannot be reused. The shared Electron installation, bundle identifier, and Helper layout remain unchanged. The packaged macOS main executable and Helpers continue to derive their names from Electron Builder's `productName`.

Windows fresh installs derive the executable and default installation directory from the full product name. Existing in-place installations may retain the directory previously chosen or recorded by NSIS; the application does not move an installed directory during upgrade. Linux uses `open-deepseek-harness-desktop` as the executable slug because command names do not contain display-name spacing.

Stable technical identities remain unchanged: `ai.flaq.deepseek-harness`, `open-deepseek-harness-desktop` user-data ownership, the existing Linux package identity, update metadata, and Release asset filenames. This preserves Profile discovery, application upgrades, uninstallation, and download compatibility.

## Alternatives considered

**Rename every technical identifier.** This would make the repository slug, application-data directory, Linux package identity, and Release files visually uniform, but risks parallel installations, lost upgrade detection, inaccessible user data, and broken update selection.

**Change only the window title.** The visible mismatch would remain in Activity Monitor, Task Manager, `.app` and `.exe` names, shortcuts, and fresh installation directories.

**Keep the short `Open DSH Desktop` name on macOS.** A platform-specific short name recreates the original inconsistency and makes support screenshots and process diagnosis ambiguous.

## Consequences

New source wrappers and packaged applications present the full product name consistently. The macOS development wrapper still contains an internal launcher file named `Electron`; this is required for development-mode detection and is not the user-facing application name or runtime process title. Windows users upgrading an existing install can still see the old directory path until they choose a new location or perform a fresh install; this is intentional compatibility behavior, not a failed rename. Old macOS package paths remain recognized only by the proxy benchmark helper so it can test already released builds.

## Verification

Unit tests cover canonical native-menu copy, renderer-title normalization, and Windows shortcut naming. Packaging configuration and smoke tests assert the new macOS and Windows executable names and macOS Helper layout. Desktop TypeScript, the Desktop build, focused tests, documentation gates, and whitespace validation cover source integration. Native Windows, Linux, and final packaged macOS process-name verification remain release-platform checks.
