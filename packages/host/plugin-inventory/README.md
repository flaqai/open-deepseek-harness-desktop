# @deepseek-ai/dsh-host-plugin-inventory

English | [中文](README.zh.md)

Besides guarded installation, `startUninstall` accepts an exact registry package name and runs `dsh plugin --profile <name> remove <package>` through the managed subprocess boundary. Versions, paths, URLs, flags, and shell text are rejected.

Host projection of the current Cordis Loader tree plus controlled profile-plugin installation. `PluginInventoryGateway` registers the `pluginInventory` service and publishes three generated direct Remotes: `pluginInventory/list`, `startInstall`, and `getInstall`. Every list call reads `ctx.loader.entries()` directly, skips structural group rows, and returns the remaining entries in Loader order with only their Loader entry id, module specifier, effective enablement, and current root Fiber phase.

`startInstall` accepts a structured profile name and npm registry package specifier. It rejects paths, URLs, flags, and shell text, requires the managed subprocess capability, and starts the running product launcher's `dsh plugin --profile <name> add <package>` mode without shell interpolation. The call returns immediately with a job id; `getInstall` polls running, succeeded, or failed state and bounded package-manager diagnostics. One target has at most one running job. A successful install updates the profile dependency and bundle layer through the same CLI path, but never mutates the already-booted Loader tree; restart activates the new composition.

The phase is `pending`, `loading`, `active`, `failed`, or `unloading`; it is `null` when the entry has no live root Fiber. The snapshot is intentionally point-in-time: Loader remains the sole lifecycle authority, while this package owns no inventory cache, history, provenance model, or event stream. Installation mutates only the selected profile's next-boot composition. Its public payload types live under `./types`, and Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

The service is Remote-only and deliberately declares no same-process Cordis `Context` merge. Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation. Installer output retention and process termination grace are deployment-configurable fields.

## Model Experience

None, as this Host inventory and installer service registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Point-in-time state only** — the result contains no durable failure history or subscription; a missing root Fiber is reported as `null`, regardless of why no live root exists.
- **No live-tree mutation** — the service does not identify which bundle or override introduced an entry and cannot enable, disable, or remove Loader rows. Installation changes a profile for its next boot.
- **Registry packages only** — Git, URL, tarball, alias, and local-path specs remain CLI-only until a Host request can represent and review each source without becoming arbitrary command execution.
