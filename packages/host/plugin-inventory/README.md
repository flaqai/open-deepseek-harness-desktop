# @deepseek-ai/dsh-host-plugin-inventory

English | [中文](README.zh.md)

Host projection of the current Cordis Loader tree plus controlled profile-plugin management and shared-dependency health. `PluginInventoryGateway` registers the `pluginInventory` service and publishes direct Remotes for listing, install/uninstall jobs, current dependency-doctor checks and repair, quarantine retry and residual uninstall, and retained repair-notice dismissal. A quarantine uninstall rejects plugins still present in profile dependencies or bundle order, removes the inactive top-level package directory, and clears its durable record only after removal. Every list call reads `ctx.loader.entries()` directly, skips structural group rows, and returns the remaining entries in Loader order with their Loader entry id, module specifier, effective enablement, and current root Fiber phase. The same snapshot projects the configured profile's latest material repair report and durable quarantine records without exposing filesystem paths.

`externalTools` projects Host connection settings, and `setExternalTool` changes one supported product through `AgentPresets`. The Host accepts only the closed `codex` and `claude-code` ids and registers the product-specific projector that mounts fixed `dsh-tool-subagent` bindings into eligible Agent scopes. The roster owns persistence, complete-mode eligibility, safe idle/turn-boundary timing, and durable per-step capability records rather than exposing those controls to the browser.

`startInstall` accepts a structured profile name and npm registry package specifier. It rejects paths, URLs, flags, and shell text, requires the managed subprocess capability, and starts the running product launcher's `dsh plugin --profile <name> add <package>` mode without shell interpolation. `startUninstall` applies the same boundary to an exact registry package name. `startDependencyDoctor` executes the core read-only `doctor` command or its explicit `--repair` mode; `getDependencyDoctor` returns structured `healthy`, `issues`, `repaired`, `quarantined`, or `failed` state and projects conflicts and orphaned bundles without local paths. Quarantine retry invokes `doctor --retry` for the selected durable id, preserving the recorded dependency specifier and bundle position rather than synthesizing a registry install. Calls return immediately with a job id; one target has at most one running job. Successful mutations change only the profile's next-boot composition; they never mutate the already-booted Loader tree.

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
- **Web profile projection** — the shipped Settings assembly projects the `web` profile; the Host config can select another profile, but one gateway does not aggregate health across profiles.
