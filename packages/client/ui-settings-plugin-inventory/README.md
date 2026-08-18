# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

English | [中文](README.zh.md)

When inventory contains `dshmarket`, its expanded card exposes a risk-confirmed uninstall action backed by the core Host Remote. Packaged launches honor a successful removal instead of reinstalling the market.

Web plugin inventory and discovery UI. The browser plugin registers one localized `settings.plugins.tab` contribution with id `all`; the Plugins section owns the navigation entry and tab chrome. It also contributes the root-scoped `conversation.hero.pluginDiscovery` entry to the new-session home screen. The entry opens a curated guide to community projects that explicitly document the official `dsh plugin --profile ... add ...` flow. Each card identifies the third-party source and license, shows a dated Star band, links to its repository, copies the documented command, and offers guarded installation through the structured Host Remote. Installation requires an explicit risk acknowledgement, reports background progress and bounded diagnostics, and explains that restart activates the new bundle. The UI never forwards arbitrary shell text or fetches GitHub data at runtime. The footer links to the complete GitHub `dsh-plugin` topic for broader discovery; topic membership and Star counts are not security review or DeepSeek endorsement.

The inventory tab performs no Remote read during plugin activation. Selecting the tab for the first time mounts it and lazily calls `ctx.remote.pluginInventory.list()` through [`api-remotes`](../../api/remotes/README.md).

The tab renders a searchable two-column catalog of compact disclosure cards. Each collapsed card uses the short module name as its title and a small effective-enablement tag; enabled entries also show a colored root-fiber status dot. Expanding one card reveals its Loader-tree entry id without a redundant field label, followed by the effective configuration and, for enabled entries, Cordis status. Disabled entries omit the redundant unmounted runtime state. The entry id remains the React key, disclosure identity, detail value, and an additional search target; it is never classified by string shape. Loading, empty, no-match, and generic failure states stay local to the mounted component, and a failed read can be retried without exposing transport details. The registration uses `ctx.slots.inject()`, so it follows late tab declaration, redeclaration, locale changes, and teardown without importing the section owner.

## Model Experience

None, as this package visualizes Host-owned deployment state and starts user-confirmed profile installation in browser UI; it registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One snapshot per Settings mount or retry** — the tab does not subscribe to Loader changes or automatically refetch after reconnect; switching tabs preserves the current snapshot, while reopening Settings obtains a new one.
- **Read-only Loader view** — local search does not add provenance, current-browser activation diagnosis, grouping by source, or live Loader mutation controls.
- **Dated discovery metadata** — the curated cards are a source-reviewed guide captured on 2026-08-16, not a live ranking. The linked GitHub topic is the source for a broader and changing catalog.
- **Registry install sources only** — the install action accepts reviewed npm registry package specs. Git, URL, alias, tarball, and local-path sources remain available through the displayed CLI workflow.
