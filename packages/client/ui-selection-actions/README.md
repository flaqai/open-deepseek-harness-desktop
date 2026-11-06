---
description: "Contextual copy and conversation-draft actions for selected read-only conversation text."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-selection-actions

English | [中文](README.zh.md)

## Summary

This package adds desktop-oriented Copy, Ask in new conversation, Ask in side conversation, and Add to conversation actions for text selected inside explicit conversation scopes. In Electron, the right-click menu also ends with Quick restart, routed through the desktop's guarded lifecycle; ordinary browsers do not receive that action. It captures immutable text before the popup takes focus and never sends a draft automatically.

## Table of Contents

- [Use the selection actions](#use-the-selection-actions)
- [Understand the safety boundary](#understand-the-safety-boundary)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-the-selection-actions"></a>
## Use the selection actions

Right-clicking an eligible selection opens the shared `Menu contextual` appearance, including row, icon, disabled, separator, shadow, and material styling. Pointer activation preserves the selected text; the official text-interaction surface continues to position the menu. Primary-button selection remains owned by the official Quote action. All conversation actions insert the official atomic quote into the target composer without submitting it, preserving existing text and reference chips. Add to conversation targets the conversation where the selection was made. When the trusted Electron preload exposes its narrow restart capability, a separated Quick restart row appears at the bottom; browser mode omits it.

-----

<a id="understand-the-safety-boundary"></a>
## Understand the safety boundary

The menu consumes the official conversation text-interaction registry and its session-scoped keyed surface. The Chat view owns selection eligibility, positioning, and dismissal; inputs, editors, controls, settings, and non-conversation sidebar controls remain outside the feature. Draft actions follow the selected conversation and current access permissions.

Ask in side conversation creates an ordinary Session in the source Workspace and opens it in the captured parent sidebar, using the official embedded Conversation layout. It does not create or impersonate a subagent. The resource owns its Session reference until the tab closes; a restored tab opens its existing Session without inserting the quote again.

Action feedback has a separate shell overlay, so copy and draft errors remain visible after the conversation popup closes. The package installs no separate document-wide pointer or context-menu listener; the shared Menu owns menu keyboard and dismissal behavior. Creation and quote access are checked again when the action runs. A failed side opening releases references and closes its own new tab; it never deletes Session data, so an already-created empty Session may remain for recovery.

<a id="model-experience"></a>
## Model Experience

None, as Browser-side draft controls; no selected text reaches model context until the human submits the resulting draft.

#### KV Cache effect

None; the package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Touch long-press selection is not handled; the first version targets mouse and trackpad interaction.
- The action list is fixed until a concrete extension consumer and permission model exist.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Preserve the official area-local text and session identity; keep the right-click consumer separate from the official selection Quote consumer.

</details>
