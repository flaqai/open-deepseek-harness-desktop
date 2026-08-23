# Agent Note: Fork CI signal scope

Status: implemented

English | [中文](2026-08-23-fork-ci-signal-scope.zh.md)

## Problem

This desktop fork does not hold a DeepSeek API key or publish the upstream npm package family, but inherited workflows treated both operations as automatic repository checks. Every main-branch update therefore produced failures unrelated to the desktop artifact: the live-API workflow failed before testing because its secret was absent, and the npm release rehearsal tried to resolve a fork-private Web package from the public registry. The macOS Sandbox job also ran the complete unit suite for documentation-only changes, where two PowerShell integration files competed with hundreds of parallel tests and returned timing-dependent terminal output. Windows desktop packaging invoked `.cmd` launchers through `spawn()` without a command shell and failed with `EINVAL` before preparing the bundled Codex plugin.

## Decision

Repository Actions remain keyless. The fork has no real-DeepSeek-API workflow; `pnpm run test:e2e` remains an explicit local check that self-skips without credentials. The upstream `Release (dsh)` npm rehearsal runs only through `workflow_dispatch`, while desktop installers continue to build from `dsh-v*` tags through the native-runner package matrix.

The Sandbox workflow ignores Markdown, Agent Note, documentation-site, and website-only pushes. Its macOS parity step excludes the two PowerShell real-shell files from the parallel repository run and then runs those files together with one worker. This retains real-shell coverage while preventing repository-wide worker contention from changing prompt detection or overflowing the terminal scrollback used by their assertions.

The bundled Codex preparation script uses the Windows command shell only for `.cmd` and `.bat` launchers. Native executables remain shell-free, and the launcher arguments remain internally constructed from validated package targets and private temporary paths.

## Alternatives considered

**Configure a repository API secret.** The fork does not need automatic paid-provider calls, and adding a secret would widen credential exposure while retaining notifications for external-service availability rather than desktop correctness.

**Keep npm release rehearsals on every push.** The fork-private branding package is intentionally not an upstream public npm package. Automatic upstream-family publication checks therefore do not represent this repository's release path; maintainers can still dispatch the rehearsal when working on that package family.

**Skip the PowerShell integration files on macOS.** That would hide the only native macOS evidence for persistent PowerShell state and UTF-8 terminal output. Single-worker execution preserves the evidence and removes the observed cross-file contention.

**Run all Windows child processes through a shell.** Shelling native executables would broaden parsing and quoting behavior without need. Only Windows command-script launchers require `cmd.exe` mediation.

## Consequences

Routine pushes produce keyless signals tied to code this fork ships, and documentation-only changes do not allocate the native Sandbox matrix. Live DeepSeek compatibility is no longer a hosted merge or nightly signal; a maintainer must run the local suite with an explicit key when changing provider behavior. Upstream npm publication drift is detected only when its manual workflow is dispatched. Windows package correctness still depends on the native Windows Actions job, while the focused macOS PowerShell run takes longer than parallel execution but yields a stable platform signal.
