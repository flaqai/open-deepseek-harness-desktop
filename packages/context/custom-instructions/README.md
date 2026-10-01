---
description: "Versioned global and Workspace custom prompts, trusted editing surfaces, and runtime-context injection."
kind: "package-reference"
---

# @deepseek-ai/dsh-custom-instructions

English | [中文](README.zh.md)

## Summary

`dsh-custom-instructions` lets a person save additional instructions for every conversation or for one registered Workspace. The active global revision is followed by the active Workspace revision on every matching model request. Empty text disables that scope. Edits take effect on the next request and do not rewrite earlier Session history.

Only first-party Settings and Workspace controls can edit this namespace. Agents and plugins receive no prompt-management API.

**Runtime invariant:** No companion is published. The Settings namespace owns revisions and the request-context adapter reads only the active revisions.

## Table of Contents

- [Use this package](#use-this-package)
- [Persistence and diagnostics](#persistence-and-diagnostics)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts the package after Workspace support. Open **Settings → Custom prompts** to edit either scope, or use a Workspace's more-actions menu to open that Workspace directly. Each non-empty save creates an immutable revision; saving an empty value disables the scope without rewriting previous revisions.

The editor and Workspace settings row use shared theme colors for fields, labels, status messages, and keyboard focus, following the application's light and dark appearance.

| Scope | Applies to | Precedence |
|---|---|---|
| Global | Every Agent, including sessions without a registered Workspace | After Workspace file instructions |
| Workspace | Agents whose Session working directory exactly matches the registered Workspace path | After the global custom prompt |

The complete order is platform and safety instructions, Agent preset, Workspace file instructions, global custom prompt, then Workspace custom prompt. Custom prompts remain user-owned guidance and cannot override platform, safety, or developer instructions.

<a id="persistence-and-diagnostics"></a>
## Persistence and diagnostics

Revisions and the diagnostic-export preference live in the `custom-instructions` Settings namespace, so ordinary community Desktop configuration copy, backup, restore, and migration carry them with other settings. Deleting a Workspace deletes its editor history only after the Workspace deletion succeeds. The exact revision used by an earlier model request remains reconstructable from that Session's runtime-context snapshot.

Session diagnostic export omits custom-prompt plaintext by default. When no choice is remembered, the export dialog lets the user include or exclude plaintext and optionally remember that exact choice. Remembering **include** shows an explicit warning because later exports will include the text without asking. Settings can restore the ask-every-time behavior.

<a id="model-experience"></a>
## Model Experience

### Active custom-instruction context

#### What the model sees

Each request contributes up to two runtime-context sections, in global-then-Workspace order.

##### Runtime-context template

```markdown
<custom-instructions scope="global" version="<revision-id>">
<active global text>
</custom-instructions>

<custom-instructions scope="workspace:<workspace-id>" version="<revision-id>">
<active Workspace text>
</custom-instructions>
```

#### Token effect

Each active scope adds its rendered text on every model request; an empty scope adds zero tokens. The 32,000-character limit applies independently to each saved revision.

#### KV Cache effect

Changing a revision changes the runtime-context suffix from the next request. Earlier Session snapshots remain unchanged and reusable prefixes before this context retain their ordinary cache behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Workspace attribution requires an exact match between the Session `cwd` and a registered Workspace path; sessions without a match receive only the global prompt.
- This feature controls trusted UI access and prompt attribution. It does not sandbox a third-party Host plugin that can already read local Settings storage.
- Existing Session snapshots retain prompt text by design. Deleting a Workspace removes editor history, not historical model-visible evidence.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
