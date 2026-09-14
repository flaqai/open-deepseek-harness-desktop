# Agent Note: Archived Session recovery

Status: implemented

English | [中文](2026-09-14-archived-session-recovery.zh.md)

## Problem

Archiving removed a Session from navigation while retaining its history and Workspace accounting, but the product exposed no place to find or restore that retained data. Users therefore needed to edit durable Workspace state manually to reverse an ordinary organization action.

## Decision

The Workspace registry provides an idempotent `unarchiveSession()` mutation that removes one id from the durable archive set without changing Session files or Workspace membership. The Workspace Remote contract and Client model expose the same mutation and install the Host-returned complete archive set.

The Workspace UI registers an **Archived sessions** Settings section. It reads the existing Session and Workspace projections, groups archived rows by their retained Workspace, supports title/id search and Workspace filtering, and restores one Session or the complete archive set. Restore failures remain on the page as retryable feedback. The page deliberately offers no permanent-delete action.

## Alternatives considered

**Treat archive as permanent.** Rejected because archive is an organization action, while the retained Session data and Workspace position already make restoration safe and unambiguous.

**Move restored Sessions into Ungrouped.** Rejected because the Workspace registry retains membership during archive; discarding that position would make recovery lossy.

**Add permanent deletion beside restore.** Rejected because irreversible Session deletion needs a separate data-lifecycle contract, confirmation design, and recovery boundary.

## Consequences

- Users can recover archived history from the Settings navigation without editing files.
- Restore changes only the archive set; Session contents, credentials, and Workspace accounting remain unchanged.
- Bulk restore applies to the complete archive set even while the page is filtered.
- Permanent deletion remains unavailable until an explicit deletion contract is designed.
