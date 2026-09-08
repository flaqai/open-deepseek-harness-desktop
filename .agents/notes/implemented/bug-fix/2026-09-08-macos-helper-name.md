# Agent Note: macOS Helper names and native package qualification

Status: implemented

English | [中文](2026-09-08-macos-helper-name.zh.md)

## Problem

Electron resolves its native Helper paths from CFBundleName before loading JavaScript. A display-brand override that differs from packaged Helper names aborts startup with SIGTRAP, even with a valid ad-hoc signature.

## Decision

The macOS package preserves electron-builder's generated CFBundleName and uses CFBundleDisplayName for display branding. The packaging workflow checks Helper executable paths and signatures in each final DMG and ZIP, then runs a bounded native readiness probe before uploading artifacts. A dedicated entry imports the desktop host only during normal startup; the probe reaches Electron readiness and exits without creating a Profile.

## Alternatives considered

**Rename Helpers separately.** This adds multiple executable and plist mutations to signing. Keeping the builder-generated names aligned avoids those additional transformations.

**Use signatures, checksums, or --version alone.** Signatures and checksums accept structurally valid but unlaunchable applications. Packaged applications can ignore --version and start the full host, so native probing needs an explicit entry.

## Consequences

Both native macOS runners reject name mismatches before release assets are accepted. The probe isolates native startup from user configuration but does not establish Harness or UI health; full application readiness remains a separate release qualification.
