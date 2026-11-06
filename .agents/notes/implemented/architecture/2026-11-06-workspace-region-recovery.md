# Agent Note: Recover the workspace browser without restarting Harness

Status: implemented

English | [中文](2026-11-06-workspace-region-recovery.zh.md)

## Problem

A workspace-slot render failure can leave the whole browsing region empty while the conversation and sidebar controls remain usable. Per-entry isolation correctly protects siblings, but an empty crash anchor gives no explanation or recovery action. A reported runtime failure that disappears after reopening does not establish whether browser state, a plugin or a data update triggered it; the Host log alone does not capture ordinary renderer exceptions.

## Decision

The sidebar owns a visible unavailable view for an empty workspace slot and an error view with explicit local retry for a failed slot. Retry restores only the eligible failed registration in that slot cell, respecting surviving registrations and disposal. It does not restart plugins, the Host or the window; a repeated failure stays visible and does not schedule another retry. Unrelated slot behavior and assembly failures retain their existing contracts.

The workspace viewing store validates its persisted browser JSON through the store engine's optional owner hydration callback. Invalid fields fall back independently while valid viewing preferences survive. Recovery records contain fixed reason and field names, not original preference values or Session contents; the recovered state is persisted only by a later ordinary action. Stores without the callback retain whole-value hydration.

Desktop observes only workspace-slot errors emitted by the selected Harness main frame. It retains bounded, credential-redacted text and available stack traces with a rate limit; logging failures never replace the application operation. This adds evidence for future incidents rather than identifying an earlier incident's trigger.

## Alternatives considered

Reloading the whole window or restarting Harness can disrupt drafts and running tasks. Automatically retrying a broken registration can create a render loop. Resetting the entire browser store discards valid preferences, while merging every generic store with object defaults breaks scalar and array stores. None is required for a local browser recovery.

## Consequences

Users can retry a failed browser without losing the open conversation. Missing registrations show an unavailable explanation rather than an ineffective retry button. A persistent plugin failure can still require configuration repair; the error view does not promise that retry resolves every fault or that missing history was deleted.

## Testing

Real slot-ledger and renderer tests cover explicit recovery, repeated failure, registration disposal and sibling preservation. Sidebar tests cover expanded, collapsed and drawer presentations. Store and WorkspaceBrowser tests exercise malformed or incomplete persisted values. Desktop tests cover trusted-frame filtering, credential redaction, size and frequency limits, and a failed log sink. Windows native incident reproduction and browser automation are outside this change's evidence.
