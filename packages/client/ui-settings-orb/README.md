---
description: "Dedicated floating-ball settings page for the community Desktop client."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-orb

English | [中文](README.zh.md)

## Summary

The Floating ball page manages display, startup, selection, avatar, and screen-edge preferences. It reads Desktop availability, permission, and task status before offering local actions. Local settings persist per `DSH_HOME`; NAS chat presentation has separate settings per paired server and cannot change remote capabilities.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open Settings → Floating ball after connecting the community Desktop to a local Home or paired NAS. The page follows Tools & capabilities in the default navigation. Existing customized navigation orders retain their other entries and insert this page next to Tools & capabilities. Local mode links back to Tools & capabilities for the official Computer Use installer.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin contributes a `settings.section` slot and subscribes to Desktop-owned settings. The renderer submits a closed settings patch to `DesktopOrbBridge`; it cannot supply an arbitrary path, URL, package, or command. In NAS mode, the bridge accepts only chat presentation changes; it does not expose backend switching and rejects local selection settings. In local mode, an unknown task state prevents backend switching, and a successful change waits for the existing quick-restart action.

With copied-text shortcuts enabled in local mode, copy text and press Cmd/Ctrl+Shift+O. Choose one of four explicit actions: Send to chat, To Chinese, To English, or Search. Supported desktops show a toolbar near the pointer; native Wayland uses a chooser because cross-application toolbar placement is unavailable. Cancel leaves the draft unchanged, and no action sends a chat message automatically. Selection actions are unavailable in NAS mode or while local task/input authority is unavailable.

<a id="model-experience"></a>
## Model Experience

None, as the page changes Desktop presentation state without contributing model context.

#### KV Cache effect

None; this package does not assemble provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Selection, backend switching, and background status are enabled only when the corresponding Host methods report availability. The page does not grant system permissions or approve background commands.
- General Web views lack the Desktop bridge. NAS mode can show remote chat only after a verified connection; local Computer Use, selection, and background-task controls remain unavailable.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep privileged window and Profile changes in the Desktop main process. A successful UI update must reflect the persisted Host state, including a failed-write rollback.

</details>
