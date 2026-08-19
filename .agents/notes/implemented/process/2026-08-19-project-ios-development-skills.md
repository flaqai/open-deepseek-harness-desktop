# Agent Note: Project-scoped iOS development skill bundle

Status: implemented

English | [中文](2026-08-19-project-ios-development-skills.zh.md)

## Problem

Contributors need the same iOS release, Simulator, performance, memory, App Intents, ASO, and SwiftUI workflows when Harness discovers skills from this checkout. A user-level Codex installation does not travel with the repository, while installing the source repository as a Codex plugin would introduce product-specific plugin and MCP configuration that the Harness project skill loader does not own.

## Decision

The repository carries the eleven skill directories from [`flaqai/ios-application-development-skills`](https://github.com/flaqai/ios-application-development-skills) commit `584f40558fce67833a36eb0cfbfdc915ef541af4` directly under `.agents/skills/`. Each directory retains its `SKILL.md`, agents metadata, references, scripts, templates, tests, and evals from that snapshot. Harness discovers these directories through its existing project-agents skill root, so the workflows are available from this checkout without modifying a user's global skill installation.

The source repository's Codex marketplace manifest, top-level agent metadata, and `.mcp.json` are not copied. Skills that require XcodeBuildMCP still state that prerequisite and must use an MCP service supplied by the active environment; installing project skills does not silently add or start that service.

## Alternatives considered

**Install the skills only into the user's Codex home.** Rejected because other checkouts and contributors would not receive the workflows, and repository behavior would depend on untracked user state.

**Install the complete source repository as a Codex marketplace plugin.** Rejected because DeepSeek Harness consumes project skill directories rather than Codex marketplace manifests, and importing `.mcp.json` would combine skill distribution with tool-service configuration.

**Reference the source through a Git submodule or symlink.** Rejected because skill discovery must work from an ordinary checkout without a second initialization step or a filesystem target outside the repository.

## Consequences

The checkout contains a reviewable snapshot of all eleven workflows and their supporting files. Updating the bundle requires selecting a new source commit, replacing all affected directories together, validating the upstream bundle, and checking that installed directories match the selected snapshot. The copied skills increase repository size and can drift from upstream until that explicit update occurs. Simulator workflows remain unavailable when the active environment does not provide compatible XcodeBuildMCP tools.

## Verification

The upstream `validate_bundle.py` check validates marketplace links, all eleven skill entries, evals, MCP metadata, and tracked upstream hashes. A recursive comparison confirms that every installed project directory is byte-identical to its source directory at the recorded commit. The repository `verify-skill-invocation-metadata` check validates cross-product invocation policy metadata.
