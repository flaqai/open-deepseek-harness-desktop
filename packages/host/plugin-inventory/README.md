---
description: "Cordis Loader and agent-preset inventory plus guarded Profile diagnostics and recovery Remotes for web GUI host clients."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-plugin-inventory

English | [中文](README.zh.md)

## Summary

Clients inspect current Loader entries and agent-preset compositions without changing configuration. Results show enablement, provenance, and runtime health at request time. Guarded operations provide fixed Profile diagnostics, quarantine, recovery, uninstall, and export actions without accepting arbitrary commands or paths. During installation, clients read bounded progress and sanitized incremental output by Host-issued install id; private pnpm paths never cross the boundary. A client may pause or cancel that exact id: the Host terminates its managed process range and waits for quiescence before publishing the terminal state. Progress observation does not change retry, timeout, diagnostic, or recovery outcomes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Call `pluginInventory/list` when a client or settings page needs to show what is currently composed in the host — which plugins are loaded, enabled, and alive, and what each agent preset would give a session. The Remote is the only entry point: the service is Remote-only and deliberately declares no same-process Cordis `Context` merge.

For an install started through the fixed request methods, poll `getInstall()` for its phase and optional `installProgress`. Use `getInstallOutput({ installId, offset })` to read only bytes added after the returned opaque cursor. `pauseInstall(id)` and `cancelInstall(id)` accept only a Host-issued id and settle after the managed process range exits. Pause is portable stop-and-resume: a later start of the same request creates a fresh guarded transaction and reuses pnpm's cache rather than suspending an operating-system process. Old output may be evicted under the configured cap, in which case `lossy` is true. Unknown or fabricated install ids fail instead of selecting a file or process.

### What a snapshot contains

Each row is one non-group Loader entry: its entry id, the exact module specifier, the effective enablement (including disabled ancestor groups), and the current root Fiber phase. `pending` means the entry waits to load, `loading` that it is being read, `active` that it is running, `failed` that its fiber rejected, and `unloading` that it is being torn down; `null` means no live root Fiber exists at all. Structural group rows are skipped.

### Per-preset compositions

With a roster composed, `agentPresets` carries one group per preset in roster order: its id, whether the deployment ships it or the user owns it (`trust`, which clients use to localize shipped names), published display name, whether a session naming no preset composes it, and flattened plugin rows — entry id (null when the file row declares none), module specifier, effective enablement, the row's own `!!js` disabled expression when it carries one, and a root-fiber phase when the composition is live. A preset some session already composed answers from its newest standing generation — even when its file has since broken, because the mount is what those sessions run; one never composed since boot answers from its composition file with disabled gates evaluated against the Loader context, and reading never mounts a preset. `conditional` enablement marks a gate the Host could not evaluate, and a broken preset nothing composed stays listed with its reason and no rows. Without a roster the field is absent.

### What you can and cannot do with it

The Loader inventory is a snapshot for display and diagnostics: a client can render the roster, flag failed entries, and detect changes by comparing snapshots. It cannot directly enable or disable arbitrary Loader entries, and it carries no Loader history — a fiber that already failed and was removed is absent. Before projecting quarantine actions, the Host removes an obsolete quarantine record only when the current Loader marks the package root active and the Profile dependency, ordered Bundle, and installed package manifest all prove that the plugin has been restored; it leaves the active plugin installed so later removal still uses the guarded package-manager operation. Separate guarded methods run the product CLI for fixed Profile operations. A quarantine-removal residue repair receives only the current Profile and server-owned diagnostic identity, then removes stale metadata for a plugin that is already inactive and absent; it cannot select another package or reinstall code.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The gateway is a direct projection with no second lifecycle truth: every `list()` call reads `ctx.loader.entries()` and maps each non-group entry to its public row. Cordis's internal plugin/status events already maintain `Entry.fiber` and `Fiber.state`, so a cache would only add another lifecycle truth to keep synchronized. The agent-preset roster is an optional peer resolved per call through `ctx.get('agentPresets')`: its `compositionInventory()` owns every preset read, and this package only maps root-fiber states onto the public phase vocabulary.

### The phase mapping

Fiber states map onto the public phase vocabulary, with `disposed` folding into `null` — an entry whose fiber is gone has no live root to report. The phase therefore never distinguishes why no live root exists: the entry may never have started, or its fiber may already have been disposed.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `PluginInventoryGateway`: the `pluginInventory` Remote service and the Loader projection |
| [`src/install-progress.ts`](src/install-progress.ts) | Incremental pnpm NDJSON parsing, progress calculation, redaction, and bounded terminal output |
| [`src/types.ts`](src/types.ts) | Public payload types: `PluginInventoryEntry`, `PluginInventorySnapshot`, `PluginFiberPhase` |
| — | No runtime invariant companion is published; every snapshot is projected directly from Loader-owned state. |

Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the inventory contract is not enough: how the Remote reaches clients, then the Loader it projects and the surface that renders it.

- [Remote assembly](../../api/remotes/README.md) — how clients consume `pluginInventory/list` without importing the Host implementation.
- [Cordis plugin loader](../../../vendor/loader/README.md) — the Loader whose entries this package projects.
- [Plugin inventory settings surface](../../client/ui-settings-plugin-inventory/README.md) — the browser-side projection that renders the inventory.

-----

<a id="model-experience"></a>
## Model Experience

None, as the host-side read-only Loader projection registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what a point-in-time inventory cannot tell a client. They are current package constraints, not a task backlog.

- **Point-in-time state only** — the result contains no durable failure history or subscription; a missing root Fiber is reported as `null`, regardless of why no live root exists.
- **No inventory provenance or arbitrary mutation** — the roster does not identify which bundle, profile, or override introduced an entry and cannot edit enablement in either plane. Guarded Profile operations accept closed request types; they are not general Loader editing or command execution.
- **Presets appear only with a roster** — a deployment without `dsh-agent-presets` serves Loader entries alone; the `agentPresets` field is absent rather than empty.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
