---
description: "Scope-grouped plugin inventory plus diagnostics, recovery, external-tool settings, and live Plugin Market discovery surfaces for the dsh web client."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

English | [中文](README.zh.md)

## Summary

The **Plugin list** tab presents agent presets first and collapses the global inventory until needed. Cards identify instances by stable entry id and expose enablement, provenance, runtime status, disabled conditions, and discovery failures; search covers both groups and points to matches in other presets. The package also presents diagnostics, imported-plugin recovery, external tools, and Plugin Market discovery. Its new-session Explore plugins control uses market-owned recommendations and Profile state for guarded installation and links to the full market without maintaining a duplicate catalog or fallback statistics. Loading, empty, failure, and retry states remain local to each mounted surface.

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

Open the Plugins section in Settings and select the **Plugin list** tab to inspect the Host's plugin inventory. The tab reads no Remote during plugin activation — selecting it for the first time mounts the component and lazily calls `ctx.remote.pluginInventory.list()` through `api-remotes`.

Open **Diagnostics** to inspect Profile dependency, Loader, quarantine, and removal consistency. A `profile.quarantine-removal-residue` card means the plugin is already inactive and absent, but derived lockfile or diagnostic state still names it; **Clean removal residue** invokes the guarded Profile doctor and never reinstalls or re-isolates that plugin.

Diagnostics distinguishes a missing Loader module from a Loader whose published code imports an unavailable dependency, and attributes either failure to the uniquely owning external Bundle. Missing internal `@deepseek-ai/dsh-*` packages are presented as DSH generation incompatibility rather than an instruction to install Host internals. When `settings.yaml` is invalid, diagnostic mode keeps the original file untouched and offers fixed-path actions to reveal it or preserve its exact bytes before resetting it to an empty valid map and restarting Harness. The diagnostic process does not turn the failed normal Profile into a successful application startup.

When a plugin's valid package-owned compatibility manifest explicitly excludes the running Harness version, startup preflight quarantines it before plugin code executes. Diagnostics displays the current Host, the plugin's exact supported versions, and its optional recommended Host, then offers **Remove old version and find update** instead of retrying the same known-incompatible package. Missing or invalid declarations are shown by omission and are never guessed from broad peer ranges.

The desktop-only **Diagnostics Lab** includes **Incomplete quarantine removal** and **Legacy Session API usage** exercises for both the isolated home and the explicitly confirmed current Profile. The Session exercise installs a reviewed inert package with the reproduced `session.events` pattern, verifies the advisory root attribution, and proves that static evidence does not automatically quarantine the package. It writes the reviewed legacy repair-report, diagnostic-report, and lockfile shape, invokes the production doctor, and retains the run report until **Restore all**; the renderer cannot supply a package, path, or arbitrary payload. Current-Profile fixtures never replace global Host overrides. Restore all performs a forced offline dependency rebuild and verifies managed-file hashes, run-attributed pnpm links, and a final Doctor result before Harness resumes; failed recovery remains visible and retryable.

### Exploring market plugins

Open **Explore plugins** on the new-session page to browse the recommended ranking or any non-empty market category. The four cards show category, author, description, 30-day downloads, stars, and installed, uninstalled, restart-required, unavailable, or unknown state. **View in Market** opens the matching market entry. **Install now** is offered only for an npm-backed uninstalled item, requires an explicit third-party-code acknowledgement, and then uses the same guarded Host/Desktop installer, diagnostics, and polling flow as Settings. Market-only sources remain view-only. If the market is absent, an explicit install or update uses the checked bundled market archive and reports that a quick restart is required. Network and catalog failures show their actual message; expired cached rankings remain available behind a stale warning.

### Reading a card

Each collapsed card uses the short module name as its primary title, shows the stable entry id underneath, and carries a small enablement tag; enabled entries also show a colored root-fiber status dot. A composition-generated subtitle omits its leading `include:` marker, while hover, search, the accessible name, and expanded details retain the complete id. Long entry ids truncate in the row and remain available on hover. Expanding one card reveals the declared entry id, the full module specifier, and the state facts: a preset row names the preset it comes from, its runtime status when the composition is live, and its disable condition when it carries one; a preset-provided global row explains that agent presets provide it per session, names the presets that enable it, and offers a jump into the preset group. Preset names resolve through the shared `presetDisplayText` fold (`dsh-agent-presets/display`) over [`ui-agent-preset`](../ui-agent-preset/README.md)'s dictionaries: shipped presets follow the active locale while user-authored ones keep their own metadata, so an English surface never echoes the preset files' Chinese names. Search filters both groups by module name and entry id.

### The preset switcher

The switcher is the same selector-pill-plus-menu control the General settings rows use. It lists every roster preset — the default suffixed as such, broken ones marked — and changes only what the list shows: it writes no settings, and selecting a broken preset shows the discovery-reported reason in place of rows. Choosing the default preset or a session's preset stays where it was: the Agent presets section and the new-session screen.

### Retrying a failed read

A failed read renders a generic failure state inside the tab; retrying re-runs the lazy `list()` call without exposing transport details.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The inventory tab is a read-only projection of a Host-owned snapshot; it performs no Remote read during plugin activation and takes the snapshot on first selection. Discovery lazily reads the Plugin Market's standard `dsh-market/registry` and `dsh-market/installed` resources, then ranks and composes four-card recommended and category views in this desktop-owned package. The compact ranking cache lasts 24 hours while installed state is refreshed on every open; manual refresh bypasses the catalog cache. A settings-domain navigation request carries the target market tab and package without coupling this package to the settings shell. Direct installation accepts only the market's explicit npm package identity and delegates the structured request to the existing guarded installer; it never executes the catalog's free-form command string.

### Registration

The browser plugin registers one localized `settings.plugins.tab` contribution with id `all`; the Plugins section owns the navigation entry and tab chrome. Registration uses `ctx.slots.inject()`, so it follows late tab declaration, redeclaration, locale changes, and teardown without importing the section owner.

### Rendering

Row keys are scope-qualified (`global:`, `preset:<id>:<index>`), so one module appearing in both scopes keeps distinct disclosure state; a declared entry id appears in expanded details and supplies the collapsed subtitle after removal of a leading composition `include:` marker, while a row without one stays unlabeled. The preset-provided marking is derived client-side: a global entry carries it when it is disabled there while at least one preset row for the same module specifier is actually enabled, so a module every preset gates off (or declares only conditionally) stays plainly disabled rather than over-claiming provision.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings section, the remote call, and the Host-side projection.

- [ui-settings-plugins](../ui-settings-plugins/README.md) — the Plugins section this tab registers into.
- [ui-settings](../ui-settings/README.md) — the domain base declaring `settings.plugins.tab`.
- [api-remotes](../../api/remotes/README.md) — the Remote BFF surface behind `pluginInventory.list()`.
- [plugin-inventory](../../host/plugin-inventory/README.md) — the Host-side read-only Loader projection this tab renders.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side inventory projection that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the freshness and reach of the inventory and discovery views; they are current package constraints.

- **One snapshot per Settings mount or retry** — the tab does not subscribe to Loader changes or automatically refetch after reconnect; switching tabs preserves the current snapshot, while reopening Settings obtains a new one.
- **Read-only inventory state** — the global and preset planes do not edit enablement or custom composition files. The only mutation exposed inside the list is the explicit guarded removal of the plugin-market package itself.
- **Market data availability** — the preview requires an installed Plugin Market exposing its standard registry and installed-state resources, plus a working catalog connection; failures are shown honestly and can be retried.
- **Bounded stale fallback** — when a 24-hour cache expires and catalog refresh fails, the old ranking remains visible only with an explicit stale warning; unknown installed state is never presented as uninstalled.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package owns a read-only Settings contribution.
