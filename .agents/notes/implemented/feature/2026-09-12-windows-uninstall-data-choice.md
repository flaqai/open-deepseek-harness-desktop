# Windows uninstall data choice

Status: implemented

English | [中文](2026-09-12-windows-uninstall-data-choice.zh.md)

## Problem

Removing the Windows application previously always retained its application-owned local data. That is safe for upgrades and reinstallations, but users had no guided way to reclaim the space or discard damaged state that can survive reinstalling the executable.

## Decision

The assisted NSIS uninstaller now presents an optional, unchecked data-removal choice before uninstalling files. It identifies conversation history, model and credential settings, plugins, plugin snapshots, logs, caches, and desktop preferences, explains that removing them may reclaim space or clear damaged state, and requires a second destructive confirmation.

Only entries owned by the installed application under `%APPDATA%\open-deepseek-harness-desktop` are eligible. The cleanup explicitly preserves the `development` child used by source runs. The uninstaller does not parse `data-home-setup.json`, follow the active `DSH_HOME`, or remove an official `.dsh` or another directly reused external directory. The page is skipped for silent uninstall and installer-driven upgrades, which preserve data.

macOS trash removal and Linux package managers do not provide an equivalent dependable interactive page. Those platforms continue to retain data rather than adding post-removal scripts that could delete user state without the same explicit confirmation.

## Consequences

- Ordinary uninstall, silent uninstall, and upgrades remain non-destructive by default.
- A user can deliberately reset all application-owned desktop state without manual path discovery.
- Directly reused external data remains outside the deletion boundary.
- Source-development data remains available after removing the installed application.
- Windows installer packaging must compile and visually verify the custom uninstall page; macOS and Linux need a separate in-app design if equivalent guided cleanup is required later.
