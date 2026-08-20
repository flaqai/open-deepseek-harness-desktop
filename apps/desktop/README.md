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

The desktop `dev` command watches the shell sources, rebuilds after a short debounce, and restarts Electron only after a successful build. A failed build leaves the current application running and the watcher retries after the next edit.

The app opens the same onboarding and settings surfaces as `dsh web`. Users can configure DeepSeek or another compatible API provider, choose models, inspect installed plugins, edit supported plugin settings, invoke Skills, select workspaces, and manage sessions without a second configuration store.

Packaged releases include pinned archives for `dshmarket@1.12.1`, `@xmanrui/dsh-im@0.11.0`, and `dsh-skill-picker@0.2.0` as offline, removable first-run seeds for the Web profile. Each durable seed marker survives a later uninstall, so subsequent launches do not silently restore a plugin the user removed.

## Desktop packages

Build the ad-hoc-signed, unnotarized macOS packages on a matching Mac with:

```sh
npm run package:desktop:macos:arm64
npm run package:desktop:macos:x64
```

Artifacts are written to `.artifacts/desktop-macos/`. Each package embeds the target's Harness production closure, Node 24.11.1, and pnpm 11.7.0 in one runtime archive. Preparation accepts the pinned Node archive only after its official SHA-256 matches. On first launch, the app extracts the archive into its versioned user-data directory so Node ESM sees a real `node_modules` hierarchy. The embedded Node starts Harness, and the plugin manager receives the embedded pnpm by absolute path; the runtime `bin` directory leads plugin lifecycle-script `PATH`. A layout marker invalidates caches produced by incomplete packages.

Build the unsigned Windows x64 NSIS installer on Windows with:

```sh
npm run package:desktop:win:x64
```

The installer is written to `.artifacts/desktop-windows/DeepSeek-Harness-windows-x64.exe`. It carries the official Windows x64 Node 24.11.1 executable, pnpm 11.7.0, and a symlink-free production Harness closure with its real `node_modules` hierarchy, so a user does not need Node or pnpm on `PATH`. Preparation verifies the official Node archive SHA-256, required Windows native modules, the embedded pnpm version, and a real Harness readiness launch before Electron Builder runs.

Build the Linux x64 packages on Linux with:

```sh
npm run package:desktop:linux:x64
```

The DEB and RPM files are written to `.artifacts/desktop-linux/`. Like macOS, they carry a target-native Node, pnpm, and production Harness runtime archive. The `Desktop packages` workflow builds all four native jobs, uploads the five installer variants, and produces `SHA256SUMS`. Manual runs remain artifact-only unless publication is explicitly requested from a `dsh-v*` tag; a tag push creates or updates the matching GitHub Release with fixed platform filenames.

## Process lifecycle

The Electron main process starts `node apps/cli/lib/bin.js web --host 127.0.0.1 --port 0` directly, without a shell. Every packaged platform uses its embedded target-native Node rather than Electron or a user-installed executable. The host treats only `dsh web: http://127.0.0.1:<port>` as readiness, appends stdout and stderr to Electron's platform log directory, and sends `SIGTERM` before a bounded `SIGKILL` during application shutdown. Closing the window hides it to the system tray by default; a preference can make close request a full quit, and every explicit quit waits for Harness teardown. Three consecutive exits before readiness stop automatic restarts and display retry and log actions. A still-connecting page exposes the same fixed log after fifteen seconds without declaring failure.

The tray can restore the window, reveal the Harness log, toggle notifications, enable packaged macOS login launch, or quit. Crash, terminal startup failure, and recovery notifications are optional and throttled. Desktop preferences are stored atomically under Electron `userData`; invalid fields fall back independently to safe defaults.

Set `DSH_DESKTOP_DSH_BIN` to test another built `dsh` launcher. Set `DSH_DESKTOP_NODE_BIN` when `node` is not available through the environment inherited by Electron.

## Official source updates

A confirmed upgrade fast-forwards the checkout, runs `pnpm install --frozen-lockfile`, and runs the complete repository build through the Node executable selected for the desktop Harness. Dependency and build children receive an environment with credential-bearing variable names removed. A failed preparation resets the checkout to the prior commit and prepares that version again. The result reports an incomplete rollback instead of presenting the old build as healthy when restoration fails. Successful updates require an application restart, offered by the same settings card.

Set `DSH_DESKTOP_SOURCE_ROOT` only when testing a different trusted checkout. The updater never runs for a packaged application without a Git checkout; signed release metadata and installer rollback remain prerequisites for packaged automatic updates.

## Packaged Release discovery

Packaged applications check Releases from `https://github.com/flaqai/open-deepseek-harness-desktop` after startup and on explicit request. Stable clients ignore prereleases; an rc or beta client follows the same prerelease channel and also accepts a higher stable version. Available versions appear above Settings and in General Settings. The action opens the validated GitHub Release page in the system browser; the application never downloads, installs, or replaces an installer.

## Security

The renderer has `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`. Navigation is limited to the Harness process's exact loopback origin. New HTTPS windows open in the system browser; every other new window is denied. Renderer permission requests are denied except for sanitized clipboard writes initiated by the main frame at the supervised Harness origin; clipboard reads and every other permission remain denied. The shared client therefore uses the standard Web Clipboard API without exposing a generic privileged Electron bridge.

API keys remain owned by the Harness credentials service. The desktop host neither reads nor duplicates them. The sandboxed preload exposes typed source-update calls in source runs plus desktop capabilities, preference updates, fixed-log reveal, and Release discovery. Release URLs are restricted to this repository and the renderer cannot provide a filesystem path. On Windows and Linux the preload also renders the desktop-owned title bar and sends its fixed minimize, maximize or restore, and close intents directly to the main process. It exposes no generic command, filesystem, URL-opening, download, or installation method.

Profile plugins are trusted executable code. The embedded package runtime makes their pnpm lifecycle scripts deterministic, but it does not sandbox or endorse code installed from a registry, Git repository, tarball, or local checkout.

## Cross-platform release matrix

The source host uses only Electron and Node process APIs that are shared by macOS, Windows, and Linux. macOS retains its native title bar and traffic lights. Windows and Linux use a frameless window with a Harness-owned draggable title bar and explicit minimize, maximize or restore, and close controls. The package workflow builds this matrix on matching native runners:

| Platform | Native runner | Artifacts |
| --- | --- | --- |
| macOS arm64 | `macos-15` | DMG and ZIP |
| macOS x64 | `macos-15-intel` | DMG and ZIP |
| Windows x64 | `windows-2025` | NSIS EXE |
| Linux x64 | `ubuntu-24.04` | DEB and RPM |

The Windows job silently installs its final NSIS artifact into a path containing spaces and Chinese characters, verifies the installed runtime, launches the installed application with isolated app data, and requires Harness readiness, all three preset dependencies and bundle entries, the profile lockfile, and durable seed markers before uploading the artifact. Native installation, first launch, shutdown, child cleanup, directory selection, file opening, PTY, and sandbox behavior remain release validation requirements for the other platforms. Signed update metadata waits for release signing and rollback support.

Do not package the checkout by copying all workspace sources into Electron. The release artifact must contain the published runtime closure, generated third-party notices, and no development credentials.

## Extension direction

Desktop-specific behavior remains outside the agent loop. Plugin and Skill management continue through Harness services and the existing settings UI. Remote control should enter through a transport plugin that maps an authenticated IM conversation to durable Harness session input and sends approval or question responses back through the interaction services. WeChat, Discord, and Slack adapters should be separate provider plugins over that common transport service, with explicit identity mapping, authorization, audit events, rate limits, and revocation.

The next desktop milestones are signed installers, native notifications for approval requests, a tray status surface, deep links, and an authenticated local control endpoint. Embedded browsers, Git panels, terminals, and plugin marketplaces should be added only as client plugins backed by owned Harness services, not Electron-only state.

## Limitations

- The current source run requires a built repository and a compatible Node executable.
- The macOS arm64 and x64 DMG and ZIP packages use ad-hoc signing and are not notarized; Gatekeeper requires explicit user approval on first launch.
- The Windows x64 installer is unsigned, and the Linux x64 packages are not repository-signed; users must verify `SHA256SUMS` and the release source.
- Developer ID signing, notarization, packaged automatic installation, Windows/Linux login launch, deep links, and IM control are not implemented. The source updater accepts only a clean fast-forward from official `master`; local divergence stays a manual Git operation.
- The Windows package job verifies installation and Harness readiness on its build runner. macOS and Linux package jobs still prove native assembly only and require installation and runtime validation.
