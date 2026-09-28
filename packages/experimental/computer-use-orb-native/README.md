---
description: "An experimental Orb Computer Use provider that requires a Desktop Host bridge and Host-owned caller authorization."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-computer-use-orb-native

English | [中文](README.zh.md)

## Summary

This package defines three author-style foreground tools: `orb_observe`, `orb_click`, and `orb_type`. It does not implement native capture or input. The Desktop Host must supply an `OrbHostBridge` and mount `createOrbComputerUseProvider(bridge)` explicitly. Loading the bare package fails before registering tools or a computer-use provider.

## Host integration

`bridge.open(acquireExclusive)` creates one `OrbBackend`. The backend calls `acquireExclusive()` exactly once before exposing operations and calls its returned release function during `close()`. The plugin reserves `orb-native` through the official `ctx.computerUse.register` slot before opening the backend; it removes tools, waits for calls, closes the backend, and then releases the slot. A missing backend, failed startup, or duplicate provider rejects activation.

`bridge.authorize(agent, signal)` receives the actual Agent and must check Host-owned caller identity. Tool schemas are hidden from other Agents during prompt assembly, and missing agents or false results are denied again inside every executor before native access. The renderer's `sessionId` is not authority. The Desktop bridge must supply native permission, focused-window, screenshot, and input implementations; the backend must reject stale frame IDs and focus changes before HID delivery.

Each successful operation saves its returned screenshot through `ctx.attachments` and emits a durable image block alongside the new `frame_id`. Coordinates are integer 0–1000 fractions of that image. The only actions are click and text input; there is no shell command or automatic tool approval in this package.

No runtime invariant companion is published: the provider registration and backend lifecycle have one owner, and no independently observed state can diverge.

## Dev Note

The fixed Orb reference at commit `72f1d738` informed screenshot envelopes and 0–1000 coordinates. This provider uses the current exclusive `ctx.computerUse.register` interface and keeps native authority in Desktop.

## Model Experience

### Orb tools and results

#### What the model sees

Only the authorized Orb Agent receives `orb_observe`, `orb_click`, and `orb_type` schemas. Successful results contain the frontmost app, optional window title, a fresh `frame_id`, the 0–1000 coordinate space, and a screenshot image block. The executing Host denies calls outside the authorized Orb caller.

#### Token effect

The three tool schemas add a fixed request cost. Each result adds a short text envelope and one image whose model cost depends on the selected route.

#### KV Cache effect

The schemas remain stable while the provider is mounted. Each screenshot appends a new tool result; changing the active provider changes the tool set and may invalidate a reusable prompt prefix.

## Known Limitations and Deferred Work

- **Desktop bridge** — the package is intentionally unbound until Desktop supplies native operations and a Host-owned caller check. A bare Loader row fails closed.
- **Foreground action set** — only observation, click, and text input are exposed. Scroll, drag, hotkeys, and app opening need separate reviewed native methods and tools.
- **Initial observation** — the author must call `orb_observe`; this package does not insert a first-turn screenshot into the Session.
