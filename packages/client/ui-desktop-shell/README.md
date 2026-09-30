---
description: "Desktop client settings and a scoped action for returning from its browser view."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-desktop-shell

English | [中文](README.zh.md)

## Summary

This package provides Desktop settings for browser handoff, window behavior, notifications, login launch, the managed `dsh` command, NAS pairing, and recovery. About shows community version, project links, application updates and community feedback. A browser page opened by Desktop receives only a Return to Desktop action; an independent `dsh web` browser receives no contribution.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the security boundary](#understand-the-security-boundary)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package in the desktop client bundle. It activates only when the narrow `window.deepSeekHarnessDesktop` preload bridge is present and reflects capabilities reported by the Electron main process.

Runtime & NAS keeps server metadata separate from encrypted per-device credentials. Pairing accepts only a dedicated HTTPS origin, requires explicit TLS fingerprint confirmation, and never exposes the bearer token to the renderer. Switching runtime restarts Desktop without moving data. In NAS mode the preload uses a positive allowlist for device preferences, lifecycle restart/readiness, Release checks, and the fixed NAS management surface. Local logs, plugin and process control, snapshots, diagnostic-lab, command-line registration, and filesystem-management operations are absent. The client detects the complete local shell projection before registering local-only controls, so a reduced NAS bridge remains valid and future local methods fail closed.

The Pairing Ceremony is an observable tagged-state module behind the React page. It binds each displayed certificate fingerprint to the address that produced it, discards late inspection results after the address changes, and submits only the inspected address and fingerprint. The Desktop authority remains the final owner of one-time certificate inspection and exact-origin trust.

On macOS and Windows, Use in a browser requests the current authenticated loopback page without receiving its URL. Electron opens the system browser and hides the desktop window only after a successful handoff. The browser shows Return to Desktop beside Settings; it reveals the same Electron client without starting another Harness. Open browser after startup is disabled by default and persists in Electron `userData`; each Harness generation consumes it at most once.

Native application-menu navigation uses the existing workspace and settings services. New Conversation preserves their ordinary draft behavior; About consumes update requests, while General Settings handles package download settings and the data-directory chooser. Missing plugin sections report an error without installing anything. Connection and locale subscriptions publish current menu readiness and are disposed with the plugin. See [application menus](../../../apps/desktop/README.md#application-menus) for platform behavior.

The community build registers `ja`, `ko`, `es`, `fr`, `de`, `pt-BR`, and `ru` as selectable languages and supplies static translations for the complete current Client namespace surface. Chinese and English remain owned by their feature packages; a future key that is not yet in a community dictionary falls back to English. Russian wording shared with [`@ragnoryok1/dsh-client-locale-ru`](https://github.com/Ragnoryok1/dsh-client-locale-ru) follows that language pack, while Desktop-only wording stays in this package. Unloading the package removes the complete community catalog and its dictionaries. The active Profile locale is reported to Electron for native menu and recovery copy; Electron's startup cache never writes the Profile preference.

Release discovery projects one shared state into About, the settings-panel header, and a blue sidebar action immediately beside Settings. Both update actions are absent unless a newer Release is available; selecting either opens About and reveals the update row after the panel has completed layout. The header update action uses the same compact button geometry and typography as the log-directory and configuration-file actions. Source builds expose the same projection through their development update simulator.

Community feedback accepts a type, title, details and optional reply email. Desktop adds only its version and OS to the draft. Feedback currently uses email: Send by email opens a draft addressed to `odsh_hecoococ@163.com` in the default email app; users review and send it there. No online submission button appears until a fixed receiver is configured. The address and GitHub Issues remain available if no email app opens; individual replies are not guaranteed. The official questionnaire stays in Connect to DeepSeek and identifies its official recipient. The [receiver reference](../../../apps/feedback-worker/README.md) owns optional service storage and delivery limits.

The download-network projection owns its main-process subscriptions, initial load, redacted saved values, editable draft, transient password fields, operation state, and errors. The React settings cards consume that projection and send semantic edit, save, reset, and test intents; they do not retain the preload transport or coordinate asynchronous persistence themselves.

Source builds also show Enter recovery mode. It opens the same startup-failure workspace used when Harness cannot become ready, while the healthy development Harness keeps running. Continue returns to that Harness. Four independent tools remain directly switchable after entry: external-plugin removal, plugin snapshots, data-directory selection, and redacted diagnostic export. Packaged applications neither report nor permit the development entry.

On Windows and macOS, Application icons provides local image selection, a keyboard-accessible square crop, zoom, previews, and independent tray preferences. Windows additionally accepts PNG-compressed ICO files and reports legacy DIB-only containers instead of degrading to a small frame. Cancel does not save. The card shows per-destination results and missing-image warnings; Windows adds explicit shortcut creation and update retry controls. See the [desktop icon guide](../../../apps/desktop/README.md#custom-application-icons) for platform limits and storage ownership.

-----

<a id="understand-the-security-boundary"></a>
## Understand the security boundary

The preload bridge owns every privileged desktop setting. The return action receives a per-generation loopback capability in the URL fragment, moves it to tab-scoped storage, removes it from the visible URL, and can request only that Electron reveal its window. The control listener requires the exact current Harness origin and token. The development recovery request carries no path, URL, failure text, or command; Electron supplies the fixed page and current log path after confirming a ready Harness and a source build. This package cannot read the authenticated Web URL, read arbitrary files, run arbitrary commands, choose arbitrary external URLs, or replace the application runtime.

The crop UI submits only a renderer-bound selection ID, a fixed destination, and bounded square coordinates. Electron validates and crops the image before atomic persistence; browser preview pixels are not authoritative. Closing the editor releases the draft. Icon changes do not invoke Harness or rewrite plugin configuration.

No invariant companion is published because lifecycle effects and the preload capability boundary already own this package's runtime checks.

<a id="model-experience"></a>
## Model Experience

None, as Electron-only desktop preferences and Release links; registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Platform capabilities differ: login launch and shell profile integration are reported by the desktop host rather than assumed by the browser.
- The system browser depends on the desktop process. Quitting Desktop ends the shared Harness connection; the browser retains only Return to Desktop, not Electron-only settings.
- Release installation remains host-controlled and requires a verified artifact; the client package never executes an installer itself.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep IPC narrow and capability-based. Renderer props must not accept arbitrary filesystem paths, commands, or URLs.

</details>
