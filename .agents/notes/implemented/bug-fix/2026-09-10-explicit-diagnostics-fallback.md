# Agent Note: Explicit Diagnostics fallback

Status: implemented

English | [中文](2026-09-10-explicit-diagnostics-fallback.zh.md)

## Problem

The installation-owned recovery Profile could reach readiness after the active Profile failed. Desktop then displayed that minimal Profile as an ordinary Harness workspace. Because user settings and third-party plugins were deliberately absent, onboarding could appear again, settings sections could disappear, and the user had no visible explanation that recovery had occurred.

## Decision

The recovery Profile remains an internal, installation-owned process used to support bounded repair operations, but it is never navigated as the main Harness UI. Its readiness opens the explicit **Diagnostics mode** page and preserves the active Profile failure as primary evidence. The page exposes plugin removal, plugin snapshots, safe data-directory switching, diagnostic export, and the local log directory.

The Desktop reads the bounded `web.diagnostics.json` report and projects its highest-urgency issue into the recovery shell. The paused progress label and introductory text identify the failure category and give category-specific next steps. Expanded details retain the stable diagnostic code, native code, attributed package, Loader entry or module, redacted evidence, and the local log location. Session corruption, configuration damage, dependency and integrity failures, Loader conflicts, incompatible plugin APIs, transaction failures, process-recovery records, Profile locks, and embedded-runtime failures therefore no longer collapse into the same process exit message. An unknown or damaged report remains an explicit unattributed fallback and never guesses which plugin to remove.

Retry first stops the diagnostic process and then starts the active Profile normally. A diagnostic process that also fails remains a bounded secondary failure. Desktop does not treat diagnostic readiness as proof that the active Profile or a restored plugin snapshot is healthy.

This decision supersedes the user-facing safe-mode workspace described by [Profile diagnostics and safe startup](../feature/2026-08-25-profile-diagnostic-safe-mode.md). The internal `DSH_PROFILE_SAFE_MODE` boot primitive and diagnostic settings file remain implementation details because they provide the isolated process used by the recovery page.

## Alternatives considered

**Keep the minimal Profile visible but add a banner.** The partial workspace would still expose missing settings and plugins as ordinary product surfaces, and plugin-provided diagnostics would remain unavailable. A dedicated recovery page makes the reduced capability boundary explicit.

**Stop without starting any diagnostic process.** Static log export and directory switching would remain possible, but guarded recovery flows that depend on the installation-owned runtime would lose their bounded execution environment.

## Consequences

Users no longer land in a partial workspace that resembles a product bug. Recovery is explicit, the cause and appropriate first action are visible before expanding raw details, logs are reachable before normal startup, and third-party plugins from the failed Profile stay unloaded. Normal product features remain unavailable until the active Profile starts successfully; this is intentional failure closure rather than a degraded application mode.
