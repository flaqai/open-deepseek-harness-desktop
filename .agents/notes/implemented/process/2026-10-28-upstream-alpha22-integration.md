# Agent Note: Official mobile UI in the community alpha.2 integration

Status: implemented

English | [中文](2026-10-28-upstream-alpha22-integration.zh.md)

## Problem

Community mobile drawer, viewport and focus patches overlap the official touch interaction changes. An earlier ancestry-only merge also makes Git's inferred merge base insufficient for importing the complete official delta.

## Decision

Source integration targets `dsh-v0.2.2-alpha.2` and uses the recorded functional baseline for explicit three-way reconciliation. The resulting commit retains both community and official parents. The [integration record](../../../upstream-integration.json) advances only with the completed content integration.

Mobile layout, sidebar navigation, input focus and shared touch primitives follow official composition. Community settings, approval explanations, desktop themes and file previews remain through their owned extension points. Official language dictionaries take precedence; Korean and community-only dictionaries remain, and existing `pt-BR` preferences resolve to official `pt`.

Community Desktop exposes installed LiveShare experimental metadata without selecting the bundle. Sharing uses an explicitly configured user-operated server and official identity storage; enabling does not create a share. NAS rejects known LiveShare installation and selection before Profile mutation, while the Host activation guard also rejects manually mounted entries. Opaque package sources can be identified only after resolution and remain subject to activation checks and transaction recovery.

The [conflict ledger](../../../upstream-integrations/0.2.2-alpha.2.json) records the 295 conflicted paths and the overlapping automatically merged paths. It supersedes the drawer/viewport mechanism in the [archived community mobile note](../../archived/feature/2026-09-15-mobile-responsive-shell.md).

## Alternatives considered

Keeping both mobile layout systems is rejected because their viewport and focus ownership conflicts. Replacing community desktop and NAS implementations wholesale is rejected because it discards authentication, recovery and update guarantees. A default public sharing service is outside the deployment model.

## Consequences

The development version and external-tool compatibility record follow the fixed official tag. Python and Office retain the community deployment policy and audited pins. Historical persistence records remain immutable; parallel review chains join through an explicit merge acknowledgement rather than rewriting predecessors.

Native startup exposed two integration defects: supplemental locale dictionaries could claim official namespaces before their owners, and General settings read `remoteAccess` without declaring it. Supplemental dictionaries now have a separate lifecycle-owned fallback layer; primary dictionaries win independently of activation order. General settings declares the service and Client module edge. The native readiness check rejects the recovery page, even if it emits later service-ready messages.

Development checks do not qualify installers. Phone keyboards, cross-platform installation and actual LiveShare authentication against a configured server require their own evidence before release. Integration does not create release tags or publish packages.
