# Agent Note: Desktop shell residency and Release discovery

Status: implemented

English | [中文](2026-08-20-desktop-shell-residency-and-release-discovery.zh.md)

## Problem

The packaged desktop host exited with its only window, offered no login launch or native lifecycle notifications, and exposed diagnostics only after Harness exhausted its startup retries. Users also had no application-version signal because the existing updater operates on trusted source checkouts rather than packaged Releases.

## Decision

The Electron main process owns one durable preference file under `userData`, one serialized application lifecycle, and one system tray. Closing the window hides it by default while explicit quit waits for Harness shutdown. Users may switch close behavior, native lifecycle notifications, and packaged macOS login launch through a narrow preload bridge; unsupported platforms report login launch as unavailable. Preference switches use the application blue token when enabled, an adaptive medium gray when disabled, and a white thumb in both states so their state remains visible across light and dark themes.

The connecting page reveals the fixed Harness log after fifteen seconds without treating a slow start as failure. The main process reveals that known file or its parent directory and never accepts a renderer path. Restart, repeated failure, and recovery notifications are localized from the operating-system locale and throttled by event kind.

Packaged applications query `flaqai/open-deepseek-harness-desktop` Releases and expose only normalized status plus a repository-validated Release URL. Prerelease clients follow their current prerelease channel and may move to a higher stable version; stable clients ignore prereleases. The client UI links to the Release page and does not download, install, or replace application files. Source runs retain the separate trusted-checkout updater.

## Alternatives considered

**Silent automatic updates.** Unsigned Windows artifacts and ad-hoc-signed, unnotarized macOS artifacts do not provide the signing and rollback guarantees required for unattended replacement, so the application only opens the selected Release page.

**Store desktop preferences in Harness settings.** Close and login-launch behavior must be available before the Web client connects, so Electron owns a small independent file and exposes only typed preference operations.

**Quit on close by default.** Background tasks and the supervised Harness would stop unexpectedly. Tray residency is the default, while a durable preference preserves an explicit quit-on-close choice.

## Consequences

The desktop process may remain active without a visible window, and every explicit exit path must join the same asynchronous Harness teardown. Native tray text follows the operating-system locale rather than the Web locale. Login launch is intentionally macOS-only. Release publication can provide stable artifact names and checksums, but application replacement remains a manual user action until signed distribution and rollback exist.
