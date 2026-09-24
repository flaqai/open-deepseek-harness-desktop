# Agent Note: Build community Desktop after workspace libraries

Status: implemented

English | [中文](2026-09-22-desktop-main-bundle-after-workspace-tsdown.zh.md)

## Problem

The official Desktop main process bundles workspace imports with tsdown. When that bundle ran alongside other workspace builds, a clean checkout could leave unresolved imports in `app.asar/lib/main.js` because their `lib/` entrypoints had not been emitted yet. Community Desktop uses a different packaging layout: TypeScript emits its main-process modules as ESM, and the installed application carries their declared production dependencies. An official-only main-bundle import check would not validate this layout.

## Decision

`build:community-desktop` completes the native addon, Host libraries, Client libraries, and Web assets before running `build:desktop`. The Desktop build then compiles `apps/desktop/src` into `lib/`, bundles only the sandboxed preload entries through [`tsdown.preload.config.ts`](../../../../apps/desktop/tsdown.preload.config.ts), and copies Desktop assets. The root workspace tsdown passes do not include `apps/desktop`.

The Electron main process is not a standalone tsdown bundle. Its runtime imports must resolve from Desktop production dependencies and the packaged Harness closure; the [Windows unpacked probe](../../../../apps/desktop/scripts/smoke-windows-unpacked.mjs) checks the installed entrypoints and critical packages. The Desktop package and deployment checks cover the declared production dependency set. No `desktop-bundle-imports` plugin is part of the community build.

## Alternatives considered

**Bundle the community main process after Host tsdown.** This would require a separate import policy for the community entry and its packaged dependency layout, and would duplicate modules already present in the Harness runtime. The present ESM entry plus production dependency checks keeps one package closure to verify.

**Run Desktop inside the root workspace tsdown pass.** That pass builds members concurrently and cannot order Desktop after the libraries it consumes. Keeping Desktop as the final community build step makes its prerequisites explicit.

## Consequences

A clean community checkout must complete the workspace library passes before compiling Desktop. Packaging verifies the main entry and the production dependencies it loads rather than relying on the official main-bundle check. The ordinary root `build` does not produce Desktop artifacts; `build:community-desktop` adds the final Desktop step. The [Desktop packaging guide](../../../../apps/desktop/README.md) owns the installed runtime layout.
