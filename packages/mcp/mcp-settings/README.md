---
description: "Manage Profile MCP servers from built-in settings, including stdio and HTTP connections, activation, and recovery after configuration failures."
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-settings

English | [中文](README.zh.md)

## Summary

Add, edit, enable, and remove MCP servers from the built-in settings page. Static Profile-managed servers remain editable, while dynamic expressions and servers from other configuration layers remain read-only. Local stdio commands execute trusted third-party code outside the Agent sandbox. Saving configuration does not imply that the server connected successfully.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Open MCP services in Web or community Desktop settings. Choose stdio for a local command or Streamable HTTP for an endpoint, then review the configuration before saving. Environment variables and HTTP headers can contain credentials; the editor reveals them only on request.

The page edits the current Profile, not a separate Desktop configuration store. Changes without hot reload require a restart. Existing service entries retain their namespaces and configuration; adding the built-in page does not install or start a server automatically.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host validates requests and edits the current Profile patch under its file lock. With HMR, reconciliation runs under the HMR exclusive lock and a failed activation restores the previous patch. Without HMR, the write remains pending until restart. The browser uses the generated Remote contract and shared settings controls.

Management logic derives from the MIT-licensed dsh-pluginHive MCP panel. The package retains its attribution in [NOTICE](NOTICE) and [LICENSE](LICENSE). The launcher suppresses the legacy panel only when the built-in replacement is explicitly active; it preserves the legacy package and all MCP server data.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [MCP client](../mcp-client/README.md) — connection configuration and execution limits.
- [Web styling](../../../docs/web-styling.md) — shared typography and light/dark semantics.
- [Desktop](../../../apps/desktop/README.md) — local and NAS runtime ownership.

<a id="model-experience"></a>
## Model Experience

Indirectly, through configured MCP clients that own tool schemas, server instructions, and connection resources.

#### KV Cache effect

The settings page adds no prompt text; changing server configuration can change the MCP tools and instructions exposed to subsequent model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A tool list can be empty for a valid server. The page does not equate zero tools with a failed connection.
- Servers from bundles or overlays are read-only; edit their owning configuration instead.
- Dynamic JavaScript configuration remains read-only and is never evaluated or replaced by this editor.
- The page does not download MCP executables or sandbox local server commands.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
