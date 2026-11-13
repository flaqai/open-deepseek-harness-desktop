---
description: "Profile adapter for a verified optional Python payload, packaged Node tools, and Office skills."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-workspace-runtime

English | [中文](README.zh.md)

## Summary

This adapter exposes an application-managed Python payload through `load_workspace_dependencies`. The trusted Desktop process supplies absolute paths; the plugin validates the payload metadata and paths before registering the tool. With `office: true`, it also registers the packaged DOCX, PPTX, and XLSX skills with `pythonEnvironment: workspace-dependencies`, so authoring uses the managed or user-selected Python returned by this adapter. It never downloads, extracts, activates, or removes a payload.

**Runtime invariant:** No companion is published. The Desktop runtime manager verifies the payload before this adapter mounts it in a Profile.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it only from a Desktop-owned Profile block. `runtimeRoot` must contain `runtime.json` and a platform Python tree. `node`, `pnpm`, and `nodePackages` point into the normal Harness runtime, so the optional archive contains no duplicate Node distribution. A missing path, incompatible target, malformed manifest, or duplicate normalized Python distribution fails plugin activation.

-----

<a id="model-experience"></a>
## Model Experience

### Workspace dependency discovery

#### What the model sees

The `load_workspace_dependencies` tool returns explicit Python, Node, pnpm, Python site-packages, Node packages, and locked distribution versions. Office skills become visible only when the Office capability block enables them.

#### Token effect

The stable tool declaration is present while the adapter is mounted. Each invocation appends only the returned paths and version inventory; it does not inject runtime metadata proactively.

#### KV Cache effect

The declaration remains stable for a fixed Profile. Tool results append to the transcript, while enabling or disabling the Office block changes the available skill catalog after restart.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The plugin trusts the Desktop manager's prior digest and archive verification; it revalidates payload identity and path existence, not the archive signature.

<a id="dev-note"></a>
### Dev Note

None.
