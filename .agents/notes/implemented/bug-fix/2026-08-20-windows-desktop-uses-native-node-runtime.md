# Agent Note: Use a native Node runtime in the Windows desktop package

Status: implemented

English | [中文](2026-08-20-windows-desktop-uses-native-node-runtime.zh.md)

## Problem

The Windows desktop package renamed the Harness production `node_modules` directory and launched the ESM CLI through Electron's Node compatibility mode with `NODE_PATH`. Node ESM resolution does not use that CommonJS lookup mechanism, and native packages built for ordinary Node are not guaranteed to match Electron's Node ABI. Electron could open while the supervised Harness process repeatedly exited before readiness.

## Decision

The Windows x64 package carries the official Node 24.11.1 distribution under `resources/runtime/win32-x64` and the deployed Harness closure under `resources/harness` with its real `node_modules` hierarchy. The preparation script accepts only the pinned official archive hash, materializes deployment links, recursively injects declared workspace dependencies omitted by legacy deploy, removes foreign native packages, stages pnpm 11.7.0, verifies required Windows modules, installs every preset archive with the staged runtime, and starts Harness through that exact runtime before packaging. Electron Builder 26 receives the closure's top-level `node_modules` through a dedicated resource mapping because its generic directory copier intentionally omits a source-root directory with that name.

The Electron host launches `resources/harness/lib/bin.js` with the embedded `node.exe`, passes the absolute embedded `pnpm.mjs` entry through `DSH_PNPM_BIN`, and prepends the runtime directory to plugin lifecycle `PATH`. The CLI executes that entry through its current Node process with an argument vector and no shell interpolation, so spaces in installation and archive paths remain inside their original arguments. The host does not set `ELECTRON_RUN_AS_NODE`, `NODE_PATH`, or Electron-only Node flags.

Three consecutive child exits before readiness enter a terminal startup-failure state. The loading page reports the bounded failure and log location, and offers explicit retry and open-log-directory actions.

## Verification

Desktop and CLI unit tests pin the native Node launch arguments, shell-free `pnpm.mjs` invocation, early preset failure logging, three-attempt failure limit, and explicit retry. Runtime preparation executes the embedded Node, installs all preset archives, and exercises the Harness readiness path. The Windows workflow passes silent-install and destination arguments separately to the final NSIS process, bounds and checks that process while installing into a path containing spaces and Chinese characters, verifies the installed resource layout, and requires Harness readiness plus all preset dependencies, bundle entries, lockfile, and seed markers before artifact upload.

## Alternatives considered

**Keep Electron as the Node carrier and repair `NODE_PATH`.** Rejected because ESM package resolution and native-module compatibility still depend on behavior that the standalone CLI does not use.

**Archive and extract the Windows runtime on first launch.** Rejected because the direct resource layout avoids a first-launch extractor dependency and matches the mature Windows packaging model while retaining a real `node_modules` directory.

**Require users to install Node and pnpm.** Rejected because desktop startup and plugin management must not depend on shell configuration or system tool versions.

## Consequences

The Windows installer is larger because it includes an official Node distribution and an unrenamed dependency closure. In return, application startup and plugin lifecycle commands use the same Node semantics as the CLI, package-time and installed-package smokes reject broken layouts, and a persistent startup failure becomes diagnosable instead of looping indefinitely.
