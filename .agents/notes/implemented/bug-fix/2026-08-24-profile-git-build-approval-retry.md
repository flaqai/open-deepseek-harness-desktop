# Agent Note: Profile Git build approval retry

Status: implemented

English | [中文](2026-08-24-profile-git-build-approval-retry.zh.md)

## Problem

pnpm requires an exact `allowBuilds` dependency-path rule before a Git-hosted package may run its `prepare` script. A user who explicitly installed a reviewed plugin through the market or CLI still received a failed operation and a manual YAML instruction. Large pnpm diagnostics also placed the exact key before a long stack, while dsh retained only the final 64 KiB, so the exported market log could omit the value the instruction required.

## Decision

An explicit profile `add` retains the exact dependency-path key from pnpm's structured Git-prepare hint before diagnostic truncation. dsh appends that bounded fact to the retained diagnostic, atomically adds only the exact key with value `true` to the profile's `pnpm-workspace.yaml`, and retries the same operation once.

The YAML update preserves comments and unrelated settings. An existing `false` rule remains authoritative. Missing, malformed, or unrelated diagnostics do not modify the profile, and dsh never enables every build script. A retry failure includes the original failure and the retry diagnostic.

## Alternatives considered

**Require every user to edit the profile YAML.** This preserves a separate approval step, but the plugin market already requires an explicit trust confirmation and packaged users should not need to recover an internal dependency-path key from pnpm output. Diagnostic truncation can make the procedure impossible.

**Enable all dependency build scripts.** This avoids future Git-prepare failures but discards pnpm's deny-by-default protection for unrelated and transitive packages.

**Allow the manifest name and version shown in the human error.** pnpm authorizes Git preparation against its resolution-specific dependency path, not the display version. A broader or reconstructed key can fail to match and can survive a source revision change unintentionally.

## Consequences

Installing a reviewed Git source plugin can execute its declared preparation script after the first blocked attempt, and the exact source resolution remains visible in the profile configuration. A changed Git resolution receives its own rule. Registry archives, local checkouts, explicit denials, and non-`add` package-manager operations keep their existing behavior.

Focused tests use pnpm's real local-Git preparation path, retain a key across an oversized diagnostic, preserve YAML comments, and pin explicit-denial behavior. Windows package smoke testing remains responsible for the packaged Node and pnpm execution path.
