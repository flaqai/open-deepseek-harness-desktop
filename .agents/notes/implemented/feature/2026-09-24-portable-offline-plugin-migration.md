# Agent Note: Target-specific offline plugin migration

Status: implemented

English | [中文](2026-09-24-portable-offline-plugin-migration.zh.md)

## Problem

An independent desktop import preserves the source Profile's plugin list but does not carry installed packages. Online restore fails on a disconnected destination, while copying `node_modules` transfers mutable, platform-specific executable state and pnpm project links. A package archive alone also leaves transitive dependencies to resolve online.

## Decision

The source computer may use the network to prepare one target-specific `.tgz` transfer. Desktop reads actual installed package names and versions from the selected source Profile, fetches original registry archives with exact version and integrity checks, and accepts an existing verified archive inside the source home. It prepares the selected packages' pnpm store and metadata cache with lifecycle scripts disabled. Custom, credentialed, Git, missing, and external-tool sources are reported as omissions instead of silently changing their identity. The transfer carries plugin artifacts and dependency cache, not the source Profile, sessions, credentials, or live `node_modules`.

The user selects the destination OS family, CPU architecture, and exact OS release. A source host matching all three values rehearses offline resolution during export; a different source host marks the transfer for mandatory rehearsal on the destination. Desktop verifies archive entries, hashes, package identities, and the exact target before it installs anything. The target computer performs offline rehearsal and installs only plugins still pending in the imported restore list through the managed candidate transaction. Success is recorded after target activation; failure restores the previous managed dependencies and restore state. The transfer never authorizes arbitrary renderer paths or a network fallback on the destination.

Configuration data still travels through the existing official/community import. Its chooser asks whether plugins will be restored online or from a selected transfer, and stages that transfer separately in the new home. Direct community reuse does not run this independent-copy migration.

## Alternatives considered

- **Copy the installed dependency tree:** rejected because platform-native packages, mutable files, and pnpm project registrations would bypass a fresh installation and reproduce dependency identity failures.
- **Export only top-level plugin archives:** rejected because the destination would still need network access for transitive dependencies.
- **Download on the destination:** retained as the separate online-import choice, but it cannot satisfy a disconnected destination.
- **Assume one package works on every target:** rejected because native and optional dependencies vary by OS, architecture, and release; a transfer is bound to one exact target.

## Consequences

Export may require network access and a large transfer, but the destination can validate and restore selected plugins without downloading packages. Each target combination requires its own transfer, and an archive can still fail dependency rehearsal, build approval, or plugin activation. Omitted sources require separate user action; neither a valid transfer nor imported configuration promises that every former plugin is restored.
