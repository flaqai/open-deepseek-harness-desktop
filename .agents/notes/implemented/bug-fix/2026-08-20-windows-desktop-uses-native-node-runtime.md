# Agent Note: Use a native Node runtime in the Windows desktop package

Status: implemented

English | [中文](2026-08-20-windows-desktop-uses-native-node-runtime.zh.md)

## Problem

The Windows desktop package renamed the Harness production `node_modules` directory and launched the ESM CLI through Electron's Node compatibility mode with `NODE_PATH`. Node ESM resolution does not use that CommonJS lookup mechanism, and native packages built for ordinary Node are not guaranteed to match Electron's Node ABI. Electron could open while the supervised Harness process repeatedly exited before readiness.

## Decision

The Windows x64 package carries the official Node 24.11.1 distribution under `resources/runtime/win32-x64` and the deployed Harness closure under `resources/harness` with its real `node_modules` hierarchy. The preparation script accepts only the pinned official archive hash, materializes deployment links, recursively injects declared workspace dependencies omitted by legacy deploy, removes foreign native packages, stages pnpm 11.7.0 behind a command wrapper that invokes the embedded Node, verifies required Windows modules, and starts Harness through that exact runtime before packaging. Electron Builder 26 receives the closure's top-level `node_modules` through a dedicated resource mapping because its generic directory copier intentionally omits a source-root directory with that name.

The Electron host launches `resources/harness/lib/bin.js` with the embedded `node.exe`, passes the embedded pnpm through `DSH_PNPM_BIN`, and prepends the runtime directory to plugin lifecycle `PATH`. It does not set `ELECTRON_RUN_AS_NODE`, `NODE_PATH`, or Electron-only Node flags.

Three consecutive child exits before readiness enter a terminal startup-failure state. The loading page reports the bounded failure and log location, and offers explicit retry and open-log-directory actions.

## Verification

Desktop unit tests pin the native Node launch arguments, embedded package-manager environment, three-attempt failure limit, and explicit retry. Runtime preparation executes the embedded Node, pnpm, and Harness readiness path. The Windows workflow installs the final NSIS artifact into a path containing spaces and Chinese characters, verifies its resource layout, and requires the installed application to reach Harness readiness before artifact upload.

## Alternatives considered

**Keep Electron as the Node carrier and repair `NODE_PATH`.** Rejected because ESM package resolution and native-module compatibility still depend on behavior that the standalone CLI does not use.

**Archive and extract the Windows runtime on first launch.** Rejected because the direct resource layout avoids a first-launch extractor dependency and matches the mature Windows packaging model while retaining a real `node_modules` directory.

**Require users to install Node and pnpm.** Rejected because desktop startup and plugin management must not depend on shell configuration or system tool versions.

## Consequences

The Windows installer is larger because it includes an official Node distribution and an unrenamed dependency closure. In return, application startup and plugin lifecycle commands use the same Node semantics as the CLI, package-time and installed-package smokes reject broken layouts, and a persistent startup failure becomes diagnosable instead of looping indefinitely.
