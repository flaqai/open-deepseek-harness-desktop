# Archived Sessions settings page design QA

Date: 2026-09-14

## Scope

- Settings navigation entry and archive icon
- Search and Workspace filter toolbar
- Workspace grouping and retained Session titles/timestamps
- Individual and bulk restore actions
- Loading, empty, no-match, busy, and failure states
- Narrow-width wrapping rules and long Workspace/Session names

## Visual verification

Verified in the real macOS development Electron client at the ordinary Settings panel size with five existing archived Sessions across two Workspaces.

- The new `已归档会话` row is visible in the left Settings navigation and matches the existing navigation treatment.
- Archived Sessions render as compact grouped cards, with search and Workspace filtering above the results.
- Individual restore buttons remain aligned at the right edge of each row.
- The bulk restore label initially wrapped at this width; the final CSS keeps it on one line without shrinking the title column below its safe minimum.
- Long content truncates within its column instead of widening the Settings dialog. At container widths of 470px or less, the header, toolbar, and Session rows stack.

## Functional verification

- Component tests cover grouping, searching, filtering, individual restore, restore all while filtered, retryable failure, empty state, and long labels.
- Workspace and Remote API tests cover durable, idempotent unarchive and client state convergence.
- The existing archived Sessions were not modified during visual verification.

## Intentional boundary

This page restores archived Sessions. It does not offer irreversible deletion because the Workspace archive contract retains Session files and membership rather than defining physical deletion.
