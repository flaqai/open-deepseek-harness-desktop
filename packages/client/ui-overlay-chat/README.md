---
description: "Compact authenticated conversation and history view for the community Desktop floating window."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-overlay-chat

English | [中文](README.zh.md)

## Summary

The floating window shows the current conversation, recent history, and a New conversation action without creating another Session store. It appears only in the community Desktop floating renderer and uses the same authenticated local Host as the main window. Hiding the ball does not delete conversations or stop running work.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The community Desktop composition loads this plugin for its dedicated `?surface=orb` renderer. The renderer keeps its ordinary authenticated Client connection and the existing Workspace navigation service. Ordinary browser and main-window renderers keep the standard application layout.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin occupies the root slot only in the floating renderer. It renders the existing Chat view under the selected Session provider and delegates New conversation and history selection to `uiWorkspace`; the main window continues to own its normal root slot.

<a id="model-experience"></a>
## Model Experience

None, as the package only presents existing Session events and user controls.

#### KV Cache effect

None; the package does not assemble provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The compact view is available only after the local Desktop Host authenticates; NAS mode has no floating renderer.
- System-level Computer Use, selection capture, and background-agent controls are not supplied by this presentation package.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep the floating renderer on the same authenticated Host origin; do not add an independent Session transcript or an unguarded RPC proxy.

</details>
