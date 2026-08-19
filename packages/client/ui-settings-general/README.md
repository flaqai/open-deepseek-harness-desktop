# @deepseek-ai/dsh-client-ui-settings-general

English | [中文](README.zh.md)

Settings shell, ownerless copy, and durable product-onboarding namespace. It occupies `sidebar.settings` with the trigger chrome and modal settings panel, projects the `settings.section` ledger into the navigation and the `settings.onboarding` ledger into one mounted step at a time, and registers everything on the Settings pages that belongs to no single feature — the trigger/header/close chrome content, the local configuration-file action, the General section and its `settings.general.item` slot, and the `settings` dictionaries. The slot types it renders into belong to ui-settings, the settings domain base; only the shell's own contract types live here, because they reference ui-sidebar's slot type and the base layer must depend on no `ui-*` package. Feature-owned rows (Permission, Language, Appearance), sections (Models), and conditional onboarding steps stay with their feature packages.

The shell owns only the copy for its reusable onboarding settings frame; the task overview and feature copy arrive from registrants. Nav labels may be locale-following thunks, so the nav projection resolves them through `resolveSlotLabel` and re-renders on the section ledger bump or the locale revision (an optional `ctx.get('locale')` read; no hard locale dependency). The onboarding ledger projects in ascending order and mounts exactly one step at a time. Visible steps own their overview dialog and app-root `inert` lifecycle; a mounted step still resolving private facts renders null, so nothing paints or blocks while it decides. The active registrant receives its id, `complete()`, and an `openSection({ sectionId, subsectionId?, step, complete })` callback. The shell then renders that existing Settings section in a dedicated three-step frame without the ordinary Settings navigation; **Back to steps** changes no task state, while **Complete step** invokes the registrant callback and returns to the overview. Registrants still own durable completion, capability readiness, task copy, and mutations, so independently registered flows cannot stack and the shell does not become a second configuration fact source.

A loopback browser loads the provider's `hasDocument` capability through `settings.describe` and renders **Open configuration file** only when the Host confirms that a provider-owned local document can be prepared. The action sends the pathless, loopback-only `settings.openDocument` request; the Host resolves the provider path again, materializes an absent document, and hands it to a native text editor (`open -t` on macOS, bypassing a browser file association; the desktop file association on Linux and Windows; Windows association after `wslpath -w` translation on WSL). Open failures keep the action available and render a localized error. Reopening the dialog or reconnecting refreshes availability after a transient read failure or Host topology change. Remote browsers never register the action and never issue the privileged settings read.

The Host half registers `ui-onboarding` in the user-settings seam. The setup wizard contributed by `ui-settings-models` reads and writes its `welcomeNoticeVersion` through the existing public settings boundary; the shell itself remains policy-free.

In the Electron desktop host, the preload bridge contributes a General row for official Harness source updates. The row checks current and stable commit identities, explains dirty, diverged, packaged, and network-failure states, confirms a ready update, and offers restart only after the desktop process reports a successful transactional build. Ordinary Web clients have no preload bridge and do not register this privileged row.

## Model Experience

None, as the plugin renders browser settings UI; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The desktop source updater is available only for a Git source run. Packaged updates require a signed release channel owned by the desktop host.
