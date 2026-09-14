# Agent Note: WorkBuddy stays an explicit community connection

Status: implemented

English | [中文](2026-09-14-workbuddy-external-tool.zh.md)

## Problem

The External tools page needs one place for supported official subagent providers and reviewed community model connections, without presenting third-party code as bundled or officially maintained.

## Decision

The page lists WorkBuddy beside the existing tools and marks it as a community plugin. Its closed UI identifier maps to the reviewed exact package `dsh-workbuddy-connect@0.5.0`, uses the guarded network installer, and never calls the desktop compatibility-manifest resolver reserved for official providers. The package is not bundled. Users must already have a signed-in WorkBuddy or WorkBuddy AI desktop app.

An active Loader entry means only that the plugin is ready. The page does not claim that WorkBuddy is connected because account readiness remains owned by the plugin. Every tool card uses a local theme-aware product mark, so the Settings page does not depend on remote image delivery.

## Alternatives considered

**Bundle the community plugin or treat it as an official provider.** Bundling would blur maintenance ownership and enlarge the trusted release payload. The explicit network install keeps the third-party boundary visible and preserves the existing guarded plugin workflow.

## Consequences

Users can discover and install the reviewed connector without confusing its ownership with DeepSeek-maintained providers. The pinned coordinate makes every package version update an explicit client review. The integration changes no third-party source and grants no permissions beyond the existing guarded plugin installer.
