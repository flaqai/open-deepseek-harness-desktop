# Agent Note: Desktop runs the Web profile as a supervised local process

Status: implemented

English | [中文](2026-08-16-desktop-supervised-web-host.zh.md)

## Problem

DeepSeek Harness already owns the browser interface, provider and model configuration, plugin settings, Skill invocation, sessions, workspaces, and interaction requests. A native application still needs to start that product without a terminal, keep it alive, present startup state, and constrain the extra authority introduced by a desktop web renderer.

Building a separate desktop client would create another implementation of the client plugin roster and another persistence model. It would also make every Harness UI capability choose between two release paths before independently released clients have a protocol-version contract.

The source host must establish a macOS development path without claiming broad installer support that does not exist. Windows and Linux also need an architecture that does not encode macOS-only lifecycle behavior.

## Decision

`apps/desktop` is an Electron application assembly outside `packages/`. Its main process directly starts the built `dsh` launcher with the `web` profile on `127.0.0.1` and port `0`, then loads the exact URL from the canonical `dsh web:` readiness line. The renderer is the existing Web GUI; desktop does not copy client plugins, API Provider settings, credentials, sessions, or Skills into a second application model.

One `HarnessSupervisor` owns the child process, its combined append-only log, unexpected-exit restart delay, and bounded shutdown. The launch uses an argv vector with no shell. Readiness accepts only an HTTP URL on literal `127.0.0.1`; unrelated output and non-loopback URLs cannot choose renderer navigation.

The BrowserWindow enables context isolation and renderer sandboxing and disables Node integration. Top-level navigation is limited to the chosen loopback origin. New HTTPS windows are handed to the system browser and other window creation is denied. Renderer permissions remain denied except for sanitized clipboard writes from the main frame at the exact supervised Harness origin; clipboard reads remain denied. The shared client uses the standard Web Clipboard API, so no generic privileged clipboard bridge is added.

macOS retains the native title bar and traffic lights. Windows and Linux create a frameless BrowserWindow; the sandboxed preload inserts one desktop-owned, theme-token-aware 36 px title bar above both the loading document and Web GUI. Its draggable region shows the current document title, while fixed minimize, maximize or restore, and close buttons send narrow IPC intents that the main process accepts only from the current desktop window. Harness navigation on those platforms declares the same height through the `dsh-desktop-titlebar-inset` URL parameter so fixed or full-viewport Web plugins reserve the desktop chrome instead of rendering beneath it. The Web client does not own or expose these operating-system controls.

Source runs require a compatible Node executable and built checkout. The macOS arm64 package combines a hoisted third-party production deploy, the transitive workspace runtime closure, Node 24.11.1, and pnpm 11.7.0. Preparation verifies the pinned official Node archive SHA-256 before extracting it. The application extracts the archive into a versioned user-data directory on first launch, and a layout marker invalidates incomplete caches. Embedded Node starts Harness; the host fixes `DSH_PNPM_BIN` to embedded pnpm and leads `PATH` with the embedded runtime `bin` so plugin lifecycle scripts use the same Node. The DMG and ZIP are unsigned development-validation artifacts.

## Extension ownership

Desktop chrome owns operating-system lifecycle and presentation only. Harness services remain authoritative for model configuration, plugin inventory and configuration, Skill discovery and invocation, workspace selection, approvals, and session state.

Future WeChat, Discord, and Slack control enters through a Harness transport service with provider plugins. Each adapter maps authenticated platform identities to Harness principals and durable sessions and uses interaction services for approvals and questions. Identity mapping, authorization, audit events, revocation, and rate limiting do not belong in Electron or an agent-loop conditional.

## Alternatives considered

- **Reimplement the GUI as a desktop-specific React application:** rejected because it duplicates the existing plugin-composed client, creates configuration drift, and requires every feature to maintain two UI integrations.
- **Load built frontend files and carry the API over Electron IPC:** deferred because the current Web profile already provides an assembled and tested loopback carrier. IPC is appropriate only when a desktop threat model or an independently released client justifies a second transport implementation and protocol compatibility policy.
- **Expose Electron's native clipboard through preload IPC:** rejected because an exact-origin permission grant lets the shared client retain the standard Web Clipboard API without widening the preload surface or creating desktop-only clipboard behavior.
- **Keep native Windows and Linux title bars:** rejected because the desktop host requires consistent Harness chrome on those platforms; macOS keeps its native title bar because its traffic-light placement and platform conventions remain authoritative.
- **Implement title-bar controls inside the shared Web client:** rejected because browser builds do not own operating-system window lifecycle. The preload renders the chrome and keeps its fixed IPC intents unavailable to ordinary Web code.
- **Use Tauri for the first host:** rejected for this milestone because the Harness runtime and PTY stack already require Node, so a Rust shell would not remove that runtime and would add a second toolchain before packaging is solved. The application assembly keeps Harness services independent of Electron, so a later native host remains possible.
- **Bundle the entire workspace checkout:** rejected because it includes development-only files, produces an unaudited dependency set, and weakens third-party notice and credential-exclusion guarantees. Installers use a published runtime closure instead.
- **Rename `node_modules` and expose it only through `NODE_PATH`:** rejected because Node ESM does not use `NODE_PATH`; bare imports in workspace packages still fail. The macOS package instead preserves the real package hierarchy in an archive and extracts it outside ASAR.
- **Import pnpm from the user's login shell:** rejected because Finder launches do not read shell startup files, while evaluating them would execute user configuration and make startup availability non-deterministic. The package owns both executables and passes absolute paths.
- **Build an NSIS installer on this macOS machine:** deferred because it needs a Windows-compatible packaging environment plus signing policy. The first deliverable is a structurally verified Windows x64 ZIP.

## Consequences

macOS developers get one command that opens the complete Harness GUI and supervises its real local process. The window inherits every existing Provider, plugin, Skill, workspace, and conversation improvement without desktop-specific synchronization.

The loopback HTTP server remains part of the desktop process tree. Its existing host and origin fences therefore remain security-critical, and the Electron window adds no privileged bridge that could bypass them. Profile plugins remain trusted executable code: deterministic Node and pnpm selection does not sandbox registry or Git lifecycle scripts.

Windows and Linux source compatibility follows from shared Electron and Node process APIs, but release support is not implied. The Windows ZIP prototype still needs the same real ESM-resolvable runtime layout before native validation can succeed. Native execution, process-tree validation, signing, installers, notarization, and update rollback remain release work and are stated as limitations in the desktop README.

Focused tests pin readiness parsing across chunk boundaries and direct launch resolution. The existing Web e2e suite remains the product-interface coverage because the desktop renderer runs that same assembled application.
