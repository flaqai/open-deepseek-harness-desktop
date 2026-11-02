# Agent Note: User-ordered settings navigation

Status: implemented

English | [中文](2026-08-30-user-ordered-settings-navigation.zh.md)

## Problem

Settings sections are contributed dynamically by independent plugins. Their canonical registration order is useful as a default, but a long installation can make frequently used pages inconvenient to reach. Using labels or array positions as a preference would break when the locale changes or a plugin is removed.

## Decision

The settings shell starts section and group dragging after a 200ms hold, with keyboard equivalents. A floating copy, reserved space, a theme-aware 1.5px insertion line with short vertical end caps, neighboring displacement, and a 180ms settlement show the destination; reduced-motion preferences remove transitions. Movement before activation preserves scrolling, and Escape cancels without saving. Menus appear on hover or keyboard focus and remain visible on touch devices; collapse arrows remain available. Section drops support reordering and cross-group movement; group drops move the entire group. Changes save immediately through an ordered writer. A rejected write reports failure and restores the last confirmed layout instead of retaining dependent optimistic edits. The organizer beside the title manages groups and hidden-entry recovery without duplicating sorting controls.

The Host-owned `ui-settings-general.sectionLayout` setting stores stable `settings.section` ids, user-authored group names, hidden entries, and group visibility and collapse preferences together. Older groups default to visible and expanded. The older `sectionOrder` remains the fallback until a grouped layout is saved. Hiding a navigation entry or group never disables its plugins or blocks explicit navigation to a page; the organizer remains accessible even when all entries are hidden.

The persisted layout overlays the live slot ledger rather than mutating it. New plugin sections append to the default group, while absent ids remain in their saved groups and hidden preferences for a possible reinstall. Normalization removes invalid and duplicate ids. Removing a group returns its sections to the default group; restoring defaults changes only navigation.

## Alternatives considered

**Change each plugin's registration order.** This would turn a per-user preference into shared plugin policy and would require coordinated writes across independently owned packages.

**Store labels or visible indexes.** Labels are localized and indexes move whenever a plugin appears or disappears, so either choice can silently reorder the wrong page.

**Use browser local storage.** That would bypass the existing settings document, separate the preference from the selected desktop data home, and make import/reuse behavior inconsistent with other UI preferences.

## Consequences

Users can organize a long settings rail directly, collapse groups, and recover hidden navigation from one manager. Each ordered write has a persistence commit point, independent of plugin registration order and locale labels. The additional state is one versioned layout; canonical registration order remains the fallback and the source of newly registered sections.

Settings navigation uses a version-2 ordered list of independent entries and non-nesting groups. Version-1 preferences are read without writing: ungrouped entries expand at their original position, including collapsed members; hidden entries and absent plugin identities remain preserved. The next successful layout save writes version 2. A group-title drop highlights the whole card and inserts the entry first without an insertion line. Group-member insertion uses an inset 1.5px capped line; card-external insertion uses a full-width line for an independent entry. Group names wrap before the fixed menu and collapse controls.

Groups expand and collapse over 180ms with height and opacity transitions. Collapsed members remain inert, and reduced-motion preferences disable these transitions.

Desktop settings can resize from all edges and corners while remaining centered. The default 808 × 800px size is the minimum when the viewport permits it; the maximum is 1200 × 1000px, bounded by the available viewport with 24px margins. The navigation divider adjusts the left column from 196px to 320px while reserving at least 360px for content. The organizer provides Restore default size for both dimensions and the divider. Sizes survive reopening within the running client; mobile uses its responsive layout.
