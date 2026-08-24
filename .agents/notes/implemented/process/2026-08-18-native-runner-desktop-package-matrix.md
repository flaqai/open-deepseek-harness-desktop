# Agent Note: Native-runner desktop package matrix

Status: implemented

English | [中文](2026-08-18-native-runner-desktop-package-matrix.zh.md)

## Problem

The desktop application depends on platform-specific Node packages and native binaries. A package assembled for another operating system or CPU can have the expected Electron files while carrying a Harness runtime that cannot load on the user's machine. The original desktop scripts prepared only a macOS arm64 runtime and an unsigned Windows x64 ZIP, so adding target flags on one host could not produce the five release assets named by the project.

## Decision

`.github/workflows/desktop-packages.yml` builds every artifact on a matching native GitHub runner. macOS arm64 and x64 each produce an ad-hoc-signed DMG and update ZIP, Windows x64 produces an NSIS installer, and Linux x64 produces DEB and RPM packages. The workflow uploads the installers as separate artifacts and records their SHA-256 values in one `SHA256SUMS` artifact; it does not create or publish a GitHub Release.

`apps/desktop/scripts/prepare-unix-runtime.mjs` derives its target from the native Node process. It accepts only darwin-arm64, darwin-x64, and linux-x64, downloads the matching pinned Node 24.11.1 archive after verifying the official SHA-256 value, deploys the production Harness closure, verifies the target's Koffi, Sharp, and require-builtin native packages, embeds pnpm 11.7.0, and writes a target-specific archive. Packaged macOS and Linux applications extract that archive into versioned user data and start Harness with its embedded Node and pnpm.

Windows keeps a separate symlink-free runtime closure because Electron supplies its Node-compatible executable. The installed application materializes pnpm launchers beside that executable and exposes the neutral `runtime-dependencies` directory through `NODE_PATH`.

The Windows NSIS configuration leaves `useZip` unset, so electron-builder uses its default 7z/LZMA payload. The native smoke installs that payload into a path containing spaces and Chinese characters before starting the application. A ZIP-payload trial did not create the installed executable or Harness files within the 15-minute deadline, while the default payload completed installation and reached Harness readiness.

The TypeScript desktop build emits ES modules for the main process, but Electron's sandboxed preload loader requires CommonJS. A dedicated tsdown pass therefore bundles the preload and its local window-frame helper into `lib/preload.cjs` while preserving `electron` as a runtime `require`; the BrowserWindow loads that `.cjs` artifact.

Release filenames omit the package version so `releases/latest/download` URLs remain stable: `DeepSeek-Harness-macos-{arm64,x64}.dmg`, `DeepSeek-Harness-windows-x64.exe`, `DeepSeek-Harness-linux-x64.{deb,rpm}`, and `SHA256SUMS`. Each package includes the removable first-run plugin-market seed.

## Alternatives considered

**Cross-build every artifact from one macOS host.** Electron can assemble some foreign shells, but pnpm installs native optional dependencies for the current host. A foreign-looking artifact would therefore provide no evidence that its Harness runtime can load.

**Use Electron as the Node carrier on every platform.** This works for the Windows closure, but the Unix packages need a normal Node and pnpm toolchain for plugin lifecycle scripts. Embedding the pinned upstream Node archive gives those scripts the same runtime that starts Harness.

**Publish releases directly from the build workflow.** The first matrix needs native packaging evidence without write access or an accidental public release. The workflow retains downloadable Actions artifacts; release publication remains a separate, explicit operation after validation.

**Load the TypeScript-emitted `preload.js` directly.** The desktop package is an ES module package, so TypeScript emits an `import`-based preload. Electron's sandboxed preload loader treats that file as CommonJS and rejects it before the bridge is installed.

**Use ZIP compression inside the NSIS installer.** ZIP can reduce decompression CPU time, but the reviewed Windows runner did not complete extraction of this runtime within 15 minutes. The default 7z/LZMA payload keeps the installer path proven by the native install-and-launch smoke.

## Consequences

The package matrix consumes four native jobs and cannot be reproduced completely on one developer machine. A successful job proves that the matching native dependency closure and installer format were assembled, while product support still requires platform lifecycle, PTY, filesystem, sandbox, installation, and first-launch validation. Fixed filenames make later latest-release links stable, at the cost of allowing only one artifact per platform and architecture in a release. Windows packaging favors the proven 7z/LZMA installation path over the attempted ZIP payload's extraction profile.
