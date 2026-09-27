---
description: "Dedicated floating-ball settings page for the community Desktop client."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-orb

English | [中文](README.zh.md)

## Summary

The Floating ball page owns the community Desktop's display, startup, selection, avatar, and screen-edge preferences. It reads the Host's availability, permission, and task status before offering local actions. Settings persist per `DSH_HOME`; the page cannot change a NAS host or a general Web client.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open Settings → Floating ball after starting the community Desktop against a local Home. The page follows Tools & capabilities in the default navigation. Existing customized navigation orders retain their other entries and insert this page next to Tools & capabilities. The page links back to that section for the official Computer Use installer.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin contributes a `settings.section` slot and subscribes to Host-owned settings. The renderer submits a closed settings patch to `DesktopOrbBridge`; it cannot supply an arbitrary path, URL, package, or command. Host status determines whether selection and backend controls are enabled, and an unknown task state prevents backend switching. A successful backend change waits for the existing Desktop quick-restart action; the page never restarts automatically. The Host rejects invalid values and unavailable NAS context.

<a id="model-experience"></a>
## Model Experience

None, as the page changes Desktop presentation state without contributing model context.

#### KV Cache effect

None; this package does not assemble provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Selection, backend switching, and background status are enabled only when the corresponding Host methods report availability. The page does not grant system permissions or approve background commands.
- Web and NAS views show an unavailable state rather than a local floating window.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep privileged window and Profile changes in the Desktop main process. A successful UI update must reflect the persisted Host state, including a failed-write rollback.

</details>
