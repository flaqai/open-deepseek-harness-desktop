---
description: "Right-Sidebar browser tabs for sandboxed HTTP(S) pages, including loopback services."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-browser

English | [中文](README.zh.md)

## Summary

Browse HTTP(S) pages, including loopback services, inside independent right-Sidebar tabs. Web and the community Desktop use an iframe with application-managed history. The package never injects Electron or Node access into visited content.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Browser is disabled by default in Web profiles and enabled on Desktop. Enable the shipped entry through the Web profile patch to use it. Open **Browser** from the right-Sidebar guide and enter an HTTP(S) URL. Chat HTTP(S) links open here when the [link preference](../ui-chat/README.md) selects **In-App Sidebar**. A host name without a scheme becomes HTTPS. Public and loopback targets use the same default sandbox. Each guide action or delegated message-link activation creates another Browser tab.

### When to choose it

Choose Browser for a Web page that should remain beside the current Session. Choose [Document Preview](../ui-sidebar-documentpreview/README.md) for local files, and use the explicit external-browser action when a site refuses iframe embedding or needs browser capabilities this package withholds.

### Minimal configuration

The package has no plugin configuration. A Web profile enables the shipped entry through its profile patch:

```yaml
- id: ui-sidebar-browser
  disabled: false
```

Client plugins can open a tab through `ctx.sidebarRight.openTab('browser', { params: { url } })`. The optional URL passes the same validation as address-bar input before navigation.

The `browser.new` command opens a separate Browser page in the focused dock pane, replacing a guide and retaining existing content pages. From the conversation or a floating content page, it uses the active dock pane. Desktop defaults to Cmd+T on macOS and Ctrl+T on Windows; Windows and macOS Web use the [shortcut service’s platform defaults](../shortcuts/README.md); Linux Web leaves the command unbound. The guide button uses a blue globe and displays the effective shortcut inline without a duplicate tooltip.

The toolbar provides Back, Forward, Reload, Go, and Open in system browser. Web offers a temporary per-tab sandbox toggle with a warning; community Desktop keeps the iframe sandbox on and hides the toggle. The tab title follows the last application-known address, not an unreadable cross-origin page title. After a restart, Browser shows the saved title and URL; Restore or Reload opens that address only when requested.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Protocol policy

The address parser accepts HTTP and HTTPS, including loopback targets. It rejects `file:` URLs, script/data/blob input, embedded credentials, the DSH application origin, and malformed addresses. Document Preview owns local-file rendering.

### Iframe carrier

Web uses `sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"` by default and offers a temporary per-tab toggle. An escaped Web popup retains its opener and can navigate the application; an unsandboxed Web page can use downloads, dialogs, and input locks. Community Desktop fixes the iframe policy at `sandbox="allow-scripts allow-forms allow-same-origin"`: embedded pages cannot create popups, download directly, navigate the top-level application, or disable the sandbox. Its Electron main process rejects nested requests to the active Harness listener, including loopback aliases, and opens ordinary HTTPS popups only with a Harness-origin referrer and no POST body. The toolbar's external-browser action asks the main process through a main-frame-only HTTP(S) bridge. Both carriers send no iframe referrer, grant no package-owned Permissions Policy, and let visited origins use their own cookies and Web storage in the parent browser session. The package does not proxy or probe remote pages.

The iframe provider records toolbar submissions and typed tab opens. A navigation state machine treats the first iframe load for each controlled revision as known and a later load as proof that the page changed to an unreadable URL. In that unknown state the address is marked, Back, Forward, and external-open are disabled, and Reload returns to the last controlled URL. A remounted body reloads the latest application-known URL and uses its optional initial URL only before the first controlled target. History API and fragment changes that emit no iframe load remain invisible. An iframe `error` event displays a transient load-failure notice until the next controlled load without changing URL history.

### Controller

Each tab's `BrowserController` owns address validation, commands and explicit restoration. `BrowserFrame` supplies carrier-neutral navigation state; `IframeImpl` uses `BrowserNavigation`, while `ElectronWebViewImpl` observes Chromium history. `BrowserPresentation` owns physical DOM attachment. Slot injection supplies `useBrowserState` and plain callbacks, keeping provider objects and observables out of the React body.

`ElectronWebViewImpl` is selected only when the Desktop preload exposes `dshDesktop.browser`; the community Desktop preload does not expose that bridge, so it selects `IframeImpl` and does not request `keepMounted`. The unconnected WebView path expects a main-process bridge to issue guest leases and enforce navigation and permissions before it can retain guest DOM across Sidebar changes. None of those guest protections or retention rules apply to the community Desktop iframe. Shared declarations use the standard `/types` export with `import type`; the Host and Client compile through separate tsconfig files.

The page refresh shortcut calls the same reload operation as the toolbar. Its tooltip and ARIA key combination follow the effective binding. The community Desktop has no leased Browser guest; Web leaves browser-reserved combinations unchanged.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Right Sidebar](../../../docs/subsystems/sidebar-right.md) — tab composition, navigation, and lifecycle.
- [Document Preview](../ui-sidebar-documentpreview/README.md) — local source, Markdown, images, HTML, and PDF rendering.
- [Sidebar Browser decision](../../../.agents/notes/implemented/feature/2026-09-16-sidebar-browser.md) — iframe behavior and controller ownership.
- [Desktop Browser decision](../../../.agents/notes/implemented/feature/2026-09-20-desktop-browser-webview.md) — webview leases, CWD storage grouping and manual restoration.

-----

<a id="model-experience"></a>
## Model Experience

None, as Browser tabs are user-facing presentation state and register no tool, prompt section, or Session event.

#### KV Cache effect

None; browsing does not enter a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The isolation policy deliberately gives up some browser compatibility:

- Many sites refuse iframe embedding or need downloads, popups or top-level navigation withheld from the community Desktop frame. An HTTPS application can also block public HTTP pages as mixed content. Web can temporarily disable its sandbox for compatibility, but doing so does not bypass mixed-content or private-network policy and permits top-level navigation, downloads, dialogs, and input locks. Neither carrier isolates visited-origin cookies per Browser tab or prevents an in-frame page from choosing its own next URL.
- In Web, a popup that escapes the sandbox retains its opener and can navigate the top-level application. Community Desktop denies embedded popups; use the toolbar action to open the last known URL in the system browser. Existing sites that rely on `window.open` inside the iframe need the system browser instead.
- A later iframe load reveals that navigation occurred but not the new cross-origin URL. History API and fragment changes may remain invisible; iframe Back and Forward are unavailable after the state becomes unknown.
- Browsers conceal many iframe failures for security: DNS, TLS, mixed-content, CSP, and `X-Frame-Options` failures may emit `load` or no actionable event instead of `error`. The load-failure notice is best-effort.
- Saved title and URL survive reloads and plugin unload while the tab remains in Sidebar's layout. Closing the tab removes its checkpoint. Restart restoration does not recover page memory, unsaved forms or Chromium's history stack.
- Local files are rejected and remain owned by Document Preview.
- The community Desktop iframe does not use per-Workspace storage partitions, guest leases or WebView permission policy. Its visited origin shares the main renderer's browser session; fixed sandbox and main-process navigation checks reduce exposure but cannot provide guest-process or cookie isolation. The Harness-address check is not a general private-network or DNS-rebinding firewall.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Each navigation provider owns its live state and publishes checkpoints directly; the UI consumes the same provider state through its controller.
