# Agent Note: Desktop local browser mode

Status: implemented

English | [中文](2026-09-05-desktop-local-browser-mode.zh.md)

## Problem

The desktop application already hosts the complete Web GUI on loopback, but users can reach that exact Profile only through its Electron window. Running `dsh web` separately can select another Harness home or create a second process, while exposing the existing server address through a general renderer API would also expose its launch credential.

## Decision

Electron owns one local-browser handoff for each Harness generation. It accepts only an authenticated `http://127.0.0.1:<port>/` root emitted by readiness, retains the URL in the main process, and exposes only URL-free status and open operations through preload. The system browser exchanges the existing launch token for its authority-bound cookie and therefore shares the desktop Profile, sessions, plugins, and Host process. Electron also creates a generation-scoped return capability on a separate random loopback port. The browser receives it in a fragment, removes it from the visible URL, and can use it only to reveal the existing window; the listener requires the exact Harness origin and token.

On macOS and Windows, General Settings, the File menu, and the tray menu offer the handoff. A desktop preference, disabled by default, opens at most once for each distinct ready URL. Successful opening hides the Electron window only when its tray is available; a failed automatic opening restores the window. A late result from an invalidated generation cannot hide the current window or republish readiness.

## Alternatives considered

**Start a second `dsh web` process:** rejected because its lifecycle, random port, Profile selection, and plugin mutations could diverge from the process already supervised by Desktop.

**Return the authenticated URL to client code:** rejected because the renderer needs only the open action, while the URL contains a process launch credential and would widen the preload API into a URL carrier.

**Bind the Host to the local network:** rejected because this feature serves one user on the same computer. The shipped connection uses loopback HTTP and deliberately does not provide the transport security required for a LAN or public listener.

## Consequences

Browser and Electron views can operate on the same live state without duplicating Harness. The browser depends on the desktop process and disconnects after complete quit. Electron-only controls remain absent because the external browser has no preload bridge; it receives only Return to Desktop. Every Harness restart changes both capabilities, so automatic mode opens the newly authenticated generation rather than attempting to revive an obsolete page.
