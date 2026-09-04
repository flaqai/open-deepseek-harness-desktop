# Agent Note: Desktop Release sidebar action

Status: implemented

English | [中文](2026-09-04-desktop-release-sidebar-action.zh.md)

## Problem

Desktop Release discovery was visible only after opening Settings. A user could miss a newly discovered version while working in the main conversation surface, and the development simulator updated only its local row.

## Decision

The desktop shell owns one shared Release presentation state. A new `sidebar.settings.action` list slot sits immediately to the right of the Settings trigger without changing the existing full-width `sidebar.footer.action` rows above it. The desktop shell registers a blue, white-label update action into that seat.

The action renders only for an available Release and only while the sidebar is expanded. It opens General Settings at the update row. The settings-header action, sidebar action, and development simulator read the same controller snapshot, so they appear and disappear together.

## Alternatives considered

Putting the action in `sidebar.footer.action` would have made it a separate full-width row instead of the requested control beside Settings. Rendering a disabled or neutral placeholder when no update exists was rejected because it adds permanent noise and conflicts with the requirement to hide the action when the client is current.

## Consequences

The sidebar reserves no visible update control while the client is current, checking, unsupported without simulation, or in an error state. Existing footer plugins retain their geometry. Component tests cover real updates, no-update hiding, collapsed mode, shared simulation, and navigation; sidebar snapshots pin the adjacent seat.
