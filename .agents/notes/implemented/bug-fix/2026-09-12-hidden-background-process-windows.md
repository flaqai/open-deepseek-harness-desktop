# Agent Note: Hidden background processes on Windows

Status: implemented

English | [中文](2026-09-12-hidden-background-process-windows.zh.md)

## Problem

Several first-party process launch paths were safe in terminals but could create a visible console window when reached from the packaged Windows desktop application. The SDK runtime launcher, Profile package-manager probe and install, and the standalone Web browser helper did not explicitly request a hidden window.

## Decision

Every first-party background launch in those paths explicitly sets Node's `windowsHide` option. Standard input, output, error, exit handling, timeouts, and process ownership remain unchanged. Tests pin the option at each launch boundary so a later refactor cannot silently reintroduce the flash.

## Alternatives considered

**Hide only desktop-owned children.** SDK and CLI paths can also be called by the desktop application, so protecting only `apps/desktop` leaves indirect launches visible.

**Use detached or shell-specific launchers.** Detachment changes lifecycle ownership, while shell wrappers add quoting and process-tree risks. `windowsHide` addresses the presentation defect without changing execution semantics.

## Consequences

Packaged Windows users no longer see short-lived command windows from these background operations. Terminal invocations still collect the same output, and non-Windows platforms ignore the option. Experimental runtimes and third-party plugin processes remain outside this decision and require separate ownership review before changes.
