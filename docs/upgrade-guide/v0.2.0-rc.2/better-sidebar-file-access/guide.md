---
kind: upgrade-guide
description: "The bundled Better Sidebar no longer limits file routes to the selected workspace."
---

# Better Sidebar file routes no longer enforce the workspace limit

English | [中文](guide.zh.md)

## Change

The desktop's bundled `dsh-better-sidebar` moves from 0.22.1 to 0.24.1 for DSH 0.2.0 compatibility. The new version removes the `workspaceFence` setting and the selected-workspace check from its file routes. Files outside the selected workspace can be read or changed if the Harness process's operating-system user can access them. This affects new desktop-managed Profiles and existing Profiles whose desktop-owned seed is upgraded; explicit user version choices remain unchanged.

## Migration

1. If you relied on `workspaceFence`, do not use the selected workspace as an access restriction. The old key under `dsh-better-sidebar` in `$DSH_HOME/settings.yaml` may remain, but it has no effect; remove it to avoid a misleading setting.
2. Before enabling the upgraded plugin for untrusted content, run Harness under an operating-system account or sandbox whose filesystem permissions limit it to the intended paths. Otherwise, disable Better Sidebar in the Profile.
3. Confirm the Profile uses `dsh-better-sidebar@0.24.1` and check the process account's access to a path outside the selected workspace. The plugin no longer rejects that path merely because it is outside the workspace.
