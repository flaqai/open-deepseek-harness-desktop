# Agent Note: Mobile responsive shell

Status: implemented
Archived: 2026-10-28

English | [中文](2026-09-15-mobile-responsive-shell.zh.md)

## Problem

The compact desktop sidebar still occupied a fixed rail on phone-sized viewports, reducing the Conversation width and leaving Settings, composer controls, and right-panel chrome vulnerable to overlap or inaccessible actions in long locales.

## Decision

At 680px and below, the layout uses an overlay sidebar drawer with a bounded width, modal focus containment, inert background content, and navigation-driven dismissal. The phone drawer owns transient state separate from the saved desktop sidebar preference. Opening the right panel closes the drawer, and the right panel uses its existing fullscreen presentation without a width or mode control.

Settings uses list and detail pages on phones. Conversation content uses dynamic viewport height, safe-area padding, smaller horizontal gutters, a 16px composer editor, wrapped toolbars, and 44px primary touch targets. Wide transcript content scrolls within its own region instead of widening the page.

## Alternatives considered

- Keep the 56px compact icon rail on phones. Rejected because it permanently reduces the already narrow Conversation viewport and does not provide enough space for readable navigation labels.
- Compress the existing three-column grid in place. Rejected because it couples phone navigation to saved desktop widths and makes simultaneous left and right panels compete with the conversation.
- Add swipe-to-open gestures. Deferred because horizontal gestures conflict with text selection and horizontally scrollable code, tables, and media.

## Consequences

- Phone chat keeps the complete viewport width whenever navigation is closed.
- Keyboard and assistive-technology users can enter, traverse, dismiss, and return from the drawer predictably.
- Desktop width preferences survive crossing 680/681px and 1023/1024px boundaries.
- Real iOS Safari and Android Chrome remain platform acceptance checks; automated tests cover the responsive state and CSS contracts without browser replay.
