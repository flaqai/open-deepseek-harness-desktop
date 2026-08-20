# Agent Note: Official source checkout updates

Status: implemented

English | [中文](2026-08-16-official-source-checkout-updates.zh.md)

## Problem

The desktop source run had no product path for discovering or applying stable Harness changes from the official repository. Running an unrestricted pull from the renderer would grant command execution to Web content, overwrite unfinished work, and leave a checkout or built runtime partially updated when installation failed.

## Decision

The Electron host owns a narrow source updater. Its upstream is fixed to `https://github.com/deepseek-ai/deepseek-harness.git` and its stable branch is `master` until the official project publishes a separate stable release channel. The preload exposes only check, upgrade by an exact 40-character commit, and restart operations.

Check fetches the branch into `FETCH_HEAD` without moving the current branch. The status distinguishes current, ready, dirty, diverged, non-checkout, and failed checks. A ready update requires a clean worktree and a strict fast-forward from the current commit to the fetched commit. A fork that contains the official commit is current, while divergent commits require a manual merge.

Upgrade fetches and verifies the expected commit again, fast-forwards, installs the frozen lockfile, and performs a complete build. Installation and build receive no inherited environment variable whose name contains `KEY`, `SECRET`, `TOKEN`, or `PASSWORD`. Preparation failure resets to the recorded prior commit and prepares it again; failure of either rollback step remains visible. The app restarts only through a separate explicit action after success.

The renderer no longer registers an official-source update card in General settings. The narrow Electron updater remains host-owned for development compatibility, but ordinary product settings and Web clients expose no updater control.

## Alternatives considered

- **Expose a generic Electron process bridge:** rejected because any renderer compromise would gain arbitrary command execution and filesystem access.
- **Merge divergent branches automatically:** rejected because conflict resolution and custom downstream changes require repository-specific review; a one-click updater cannot preserve their intent safely.
- **Update packaged applications from Git:** rejected because an installer needs signed artifacts, release metadata, atomic replacement, and platform rollback rather than a mutable development checkout.
- **Move the branch before installation without rollback:** rejected because a failed dependency or build step would leave the selected version unusable.

## Consequences

The host retains bounded official fast-forward mechanics without exposing a general native bridge, but users perform source synchronization through the repository workflow instead of Settings. Local edits and downstream divergence still stop the operation before source mutation. The feature intentionally does not update packaged releases.
