# DeepSeek Harness Desktop

English | [中文](README.zh.md)

`@deepseek-ai/dsh-desktop` is the native application host for the existing DeepSeek Harness Web GUI. It starts one local Harness process, waits for its canonical readiness line, and loads that loopback origin in a hardened Electron window. The desktop app does not copy session, provider, plugin, or Skill state into an application-specific format.

## Run from this checkout

Use Node `^22.19.0 || >=24.0.0`, then build the repository before starting the desktop app:

```sh
pnpm install
pnpm run build
pnpm run dev:desktop
```

The app opens the same onboarding and settings surfaces as `dsh web`. Users can configure DeepSeek or another compatible API provider, choose models, inspect installed plugins, edit supported plugin settings, invoke Skills, select workspaces, and manage sessions without a second configuration store.

## macOS arm64 package

Build the unsigned DMG and ZIP from this checkout with:

```sh
npm run package:desktop:macos:arm64
```

Artifacts are written to `.artifacts/desktop-macos/`. The package embeds the Harness production closure, Node 24.11.1, and pnpm 11.7.0 in one runtime archive. Preparation accepts the pinned Node archive only after its official SHA-256 matches. On first launch, the app extracts the archive into its versioned user-data directory so Node ESM sees a real `node_modules` hierarchy. The embedded Node starts Harness, and the plugin manager receives the embedded pnpm by absolute path; the runtime `bin` directory leads plugin lifecycle-script `PATH`. A layout marker invalidates caches produced by incomplete packages.

## Windows x64 ZIP package

Build the reviewed Windows x64 ZIP from this checkout with:

```sh
npm run package:desktop:win:x64
```

The artifact is written to `.artifacts/desktop-windows/DeepSeek-Harness-<version>-windows-x64.zip`. It carries Electron's Node-compatible executable plus a symlink-free production Harness closure, so a user does not need Node on `PATH`. The package is unsigned, is not an installer, and has not yet been executed on a native Windows runner; release it only after native lifecycle, PTY, and update-path validation.

## Process lifecycle

The Electron main process starts `node apps/cli/lib/bin.js web --host 127.0.0.1 --port 0` directly, without a shell. A packaged macOS app uses its embedded Node rather than Electron or a user-installed executable. It treats only `dsh web: http://127.0.0.1:<port>` as readiness, appends stdout and stderr to Electron's platform log directory, restarts unexpected exits with bounded exponential delay, and sends `SIGTERM` before a bounded `SIGKILL` during application shutdown.

Set `DSH_DESKTOP_DSH_BIN` to test another built `dsh` launcher. Set `DSH_DESKTOP_NODE_BIN` when `node` is not available through the environment inherited by Electron.

## Official source updates

The General settings page exposes **DeepSeek Harness core updates** in desktop source runs. It checks `master` from the fixed official repository `https://github.com/deepseek-ai/deepseek-harness.git`, displays the current and fetched commits, and enables the upgrade action only when the local commit is an ancestor of the official commit and the worktree is clean. A fork that already contains the fetched official commit is current; diverged histories require a manual merge.

A confirmed upgrade fast-forwards the checkout, runs `pnpm install --frozen-lockfile`, and runs the complete repository build through the Node executable selected for the desktop Harness. Dependency and build children receive an environment with credential-bearing variable names removed. A failed preparation resets the checkout to the prior commit and prepares that version again. The result reports an incomplete rollback instead of presenting the old build as healthy when restoration fails. Successful updates require an application restart, offered by the same settings card.

Set `DSH_DESKTOP_SOURCE_ROOT` only when testing a different trusted checkout. The updater never runs for a packaged application without a Git checkout; signed release metadata and installer rollback remain prerequisites for packaged automatic updates.

## Security

The renderer has `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`. Navigation is limited to the Harness process's exact loopback origin. New HTTPS windows open in the system browser; every other new window is denied. Renderer permission requests are denied except for sanitized clipboard writes initiated by the main frame at the supervised Harness origin; clipboard reads and every other permission remain denied. The shared client therefore uses the standard Web Clipboard API without exposing a generic privileged Electron bridge.

API keys remain owned by the Harness credentials service. The desktop host neither reads nor duplicates them. The sandboxed preload exposes only update check, confirmed upgrade, and application restart calls to Web code. On Windows and Linux it also renders the desktop-owned title bar and sends its fixed minimize, maximize or restore, and close intents directly to the main process; those controls are not exposed as a generic Web API. The preload exposes no generic command or filesystem method.

Profile plugins are trusted executable code. The embedded package runtime makes their pnpm lifecycle scripts deterministic, but it does not sandbox or endorse code installed from a registry, Git repository, tarball, or local checkout.

## Cross-platform release plan

The source host uses only Electron and Node process APIs that are shared by macOS, Windows, and Linux. macOS retains its native title bar and traffic lights. Windows and Linux use a frameless window with a Harness-owned draggable title bar and explicit minimize, maximize or restore, and close controls. A Windows x64 ZIP package is available for native validation; the remaining release work is:

1. Sign and notarize arm64 and x64 macOS artifacts; build signed Windows x64/arm64 installers; build Linux AppImage and deb artifacts on their native CI runners.
2. Exercise shutdown, child cleanup, native directory selection, file opening, PTY, and sandbox behavior on each platform before adding it to the supported matrix.
3. Add signed update metadata only after release signing and rollback are operational.

Do not package the checkout by copying all workspace sources into Electron. The release artifact must contain the published runtime closure, generated third-party notices, and no development credentials.

## Extension direction

Desktop-specific behavior remains outside the agent loop. Plugin and Skill management continue through Harness services and the existing settings UI. Remote control should enter through a transport plugin that maps an authenticated IM conversation to durable Harness session input and sends approval or question responses back through the interaction services. WeChat, Discord, and Slack adapters should be separate provider plugins over that common transport service, with explicit identity mapping, authorization, audit events, rate limits, and revocation.

The next desktop milestones are signed installers, native notifications for approval requests, a tray status surface, deep links, and an authenticated local control endpoint. Embedded browsers, Git panels, terminals, and plugin marketplaces should be added only as client plugins backed by owned Harness services, not Electron-only state.

## Limitations

- The current source run requires a built repository and a compatible Node executable.
- The macOS arm64 DMG and ZIP are unsigned and not notarized; they are development-validation artifacts rather than a supported release.
- The Windows x64 ZIP is unsigned and has only structural verification from macOS; it is not a supported Windows release, an installer, or an auto-updating package.
- Signing, notarization, packaged auto-update, tray behavior, native notifications, and IM control are not implemented. The source updater accepts only a clean fast-forward from official `master`; local divergence stays a manual Git operation.
- macOS is the first locally exercised platform; source compatibility does not yet constitute Windows or Linux release support.
