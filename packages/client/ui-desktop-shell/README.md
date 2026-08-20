# @deepseek-ai/dsh-client-ui-desktop-shell

English | [中文](README.zh.md)

Electron-only browser UI for desktop shell preferences and Release discovery. When `window.deepSeekHarnessDesktop` is present, the plugin contributes close behavior, native notification, macOS login-launch, and desktop-version rows to General Settings, plus an available-version action above the Settings trigger. An ordinary `dsh web` browser receives no contribution.

The preload bridge owns all privileged work. This package receives normalized preferences and Release status, requests whitelisted preference changes, and can ask the main process to open the selected `flaqai/open-deepseek-harness-desktop` Release page. It cannot read arbitrary files, run commands, choose arbitrary external URLs, download installers, or update the application.

## Model Experience

None, as the plugin changes desktop chrome and application preferences without adding session events, model context, tools, or model-visible output.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- Login launch is available only in packaged macOS applications; Windows and Linux report the capability as unavailable.
- Release discovery only links to a download page. Signed automatic download, installation, rollback, and deep links are deferred.
