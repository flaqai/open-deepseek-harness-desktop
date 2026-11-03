---
kind: upgrade-guide
description: "Community Desktop alpha.3 configuration, task backups, and optional feature migration."
---

# Community Desktop alpha.3 upgrade

English | [中文](guide.zh.md)

## Change

The desktop development version follows official alpha.3. Shared context menus retain existing Session and workspace actions, while community settings groups, resizing, approval explanations and sidebar document previews remain available. Mobile navigation follows the official implementation. This integration does not publish installers.

The filesystem observation policy is disabled by default, following upstream; sandbox limits and Review remain. Existing explicit profile overrides are preserved. `apply_patch` remains disabled unless explicitly enabled by the deployment. See the [filesystem default migration](../../v0.2.2-alpha.2/fs-observation-policy-default-off/guide.md) for configuration.

## Migration

Scheduled tasks use Host-wide management. NAS task-management requests remain administrator-only. Before the first write that upgrades stored tasks to version 2, the storage backend preserves a durable backup; reads alone do not upgrade data. Older clients cannot read version 2. Restore only with the application stopped, following the [schedule backup reference](../../../../packages/schedule/schedule/README.md); a SQLite backup restores the complete database, including other units at the snapshot point.

An explicit old `@deepseek-ai/dsh-experimental-tool-worktree` bundle in the web or shared profile produces a desktop diagnostic and a backup without editing the source configuration. Remove the old entry manually after reviewing the backup; enable Change requests and worktrees separately if wanted. Backup failures produce a separate warning: preserve a manual backup before editing. No replacement feature is automatically enabled.

macOS Computer Use uses its own complete permission application. Prior Terminal or Desktop authorization does not establish authorization for that application. Keep the feature optional, follow its permission guidance when enabled, and replace unsupported bare-binary helper overrides explicitly. Python and Office deployment policies are unchanged.

**Verification limits**

Development checks do not certify a release. Phone keyboard and orientation behavior, Windows and Linux installation, the other macOS architecture, real Computer Use permission grants, signing and notarization, and offline final-installer document previews require their corresponding native acceptance before publication.
