---
description: "Compact authenticated conversation and history view for the community Desktop floating window."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-overlay-chat

English | [中文](README.zh.md)

## Summary

The floating window shows the current conversation, its normal message composer, recent history, and a New conversation action without creating another Session store. It uses the same authenticated Harness origin as the main window, including the selected NAS for remote chat. Hiding the ball does not delete conversations or stop running work.

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

The plugin occupies the root slot only in the floating renderer. It renders the existing Conversation component and composer through the keyed `main` slot and delegates New conversation and history selection to `uiWorkspace`; the main window continues to own its normal root slot. A trusted Desktop selection event inserts plain text into the selected Session's draft without sending it. If no Session is ready, the selection remains in renderer memory until a Session can accept the draft; the visible notice offers a manual retry.

<a id="model-experience"></a>
## Model Experience

None, as the package only presents existing Session events and user controls.

#### KV Cache effect

None; the package does not assemble provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The compact view requires a connected Harness origin. NAS mode allows remote chat but never grants local screenshot, input, selection, or background-task controls.
- System-level Computer Use, selection capture, and background-agent controls are not supplied by this presentation package. It consumes only the bounded selection text delivered by the Desktop Host.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep the floating renderer on the same authenticated Host origin; do not add an independent Session transcript or an unguarded RPC proxy.

</details>
