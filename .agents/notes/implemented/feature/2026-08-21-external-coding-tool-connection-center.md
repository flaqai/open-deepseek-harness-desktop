# Agent Note: External coding-tool connection center

Status: implemented

English | [中文](2026-08-21-external-coding-tool-connection-center.zh.md)

## Problem

Using a coding product as a Harness subagent requires two separate facts: its provider bundle must belong to the active Web profile, and a selected agent preset must enable the provider's tool row. Plugin inventory exposed the first fact while the agent-preset picker exposed the second only after someone already knew which preset to inspect. A successfully installed Codex provider could therefore remain practically undiscoverable, and treating every product name as installable would falsely imply provider support that the runtime does not have.

## Decision

Settings contains a root `external-tools` section beside the existing product sections. It presents one connection flow per coding product and derives state from two Host-owned snapshots in parallel: the live plugin inventory and Host connection settings. Codex and Claude Code are actionable because this release has official provider bundles for them. Their installation uses an exact package version matching the application baseline; a completed install asks for a full restart because the running Loader tree is immutable. Hermes and Trae remain disabled placeholders until an official provider bundle and tool row exist.

Connecting a supported product stores a Host setting independently from Session preset identity. `AgentPresets` owns the safe-boundary projection: the Host registers one product-specific projector, and each enabled `dsh-tool-subagent` instance is mounted in an eligible Agent's own scope. `standard`, `code`, and `cordis` participate; `minimal` remains unchanged. An idle Agent updates immediately, while an Agent already running retains its exact tool fibers until it returns to idle. The synchronous idle-to-running status transition reconciles again before prompt assembly, so a resumed historical Session receives current connections on its next turn without mutating an in-flight request.

The exact dynamic projection is logged as `external-tools/resolved` once per model-request step. A later disconnected step logs an empty list after any connected step. Model-visible tools are therefore reconstructable from the Session rather than inferred from mutable current settings, while retries of one step do not duplicate the record.

The browser never receives a filesystem path or composition document. A typed `pluginInventory` Remote accepts only the closed `codex` and `claude-code` ids and delegates preset ownership to `AgentPresets`. This keeps package installation, roster authoring, and UI presentation in their existing owners while giving the product a single discoverable entry point.

## Alternatives considered

**Put connection buttons inside Agent presets.** Rejected because provider installation and Loader activation are profile deployment state, not preset authoring state. A disabled tool row cannot explain whether its provider is missing, still installing, or waiting for restart without importing the plugin-management capability into the roster UI.

**Copy or modify `standard`.** Rejected because either choice keeps connection state coupled to Session preset selection. A managed copy also drifts from later shipped-preset improvements and leaves existing historical Sessions unable to use a newly connected product.

**Recompose a running Session's whole preset.** Rejected because that changes prompt sections, skills, listeners, isolated services, and tools together. The requested behavior needs only a product tool at the next safe request boundary; replacing the full composition would strand prior capabilities and can interrupt active work.

**Offer generic package fields for Hermes and Trae.** Rejected because a product name does not establish a compatible `SubagentProvider`, tool row, package source, or protocol contract. Disabled placeholders communicate intended navigation without turning arbitrary package installation into a connection promise.

**Install the unversioned npm latest tag.** Rejected because dist-tags can lag or move independently from the desktop baseline. Provider protocol compatibility is part of the packaged application, so this entry point pins the matching release.

## Consequences

Codex and Claude Code become visible before the user knows their package names or preset rows, and connection now means availability from the next turn of an existing or new complete-mode Session. The closed Remote and one registered projector prevent the convenience UI from becoming an arbitrary preset editor or shell launcher. The generic roster does not depend on product tool packages; the desktop Host owns fixed provider/tool bindings. Adding another actionable product requires an official provider bundle, a closed Host id, an explicit eligible-mode decision, localized product copy, and focused tests across boundary projection, durable request logging, Remote registration, and Settings interaction.

## Verification

Preset tests pin eligible modes, independent settings, existing-session projection, disconnect removal, minimal exclusion, duplicate-projector refusal, and one durable capability record per step. Host tests pin the typed Remote inventory, while client tests pin localized section registration, supported actions, honest placeholders, and the Codex connection transition. Type checking covers the projector dependency graph, generated Remote graph, and desktop client assembly.
