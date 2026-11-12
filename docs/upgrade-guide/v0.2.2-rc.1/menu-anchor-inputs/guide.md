---
kind: upgrade-guide
description: "Client Menu consumers must replace rectangle callbacks with an element ref or a captured viewport point."
---

# Menu anchor inputs

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-client-ui-primitives` replaces `Menu.getAnchorRect` with `anchorRef` for an external trigger or `anchorPoint` for a pointer-triggered menu. Portaled menus use the official rc.2 CSS anchor positioning implementation. Browsers must support its CSS anchor properties; placement follows the layout viewport rather than constraining every panel to the visual viewport. Existing selection preservation, checkbox rows and keyboard actions remain available.

This community migration retains `useAnchoredPosition` and `AnchoredPositionOptions` for custom panels outside Menu. Their later migration is separate; consumers must not assume they have already been removed.

## Migration

1. Replace `getAnchorRect={() => trigger.current?.getBoundingClientRect() ?? null}` with `anchorRef={trigger}`. An inline `anchor` needs no external ref. A missing external trigger must remain unavailable rather than falling back to a dummy element.
2. Replace a zero-size pointer rectangle callback with `anchorPoint={{ x, y }}` in client viewport coordinates. Do not add Safari visual-viewport offsets; Menu converts them once when opening or changing the point.
3. Keep `returnFocus` for the original editor or navigation control and `preserveSelection` for editing menus. Keep explicit checkbox state and accessible menu labels.
4. Rebuild every consumer and verify opening, dismissal, submenus, keyboard navigation, focus restoration, editor selection and spelling actions, including zoom, panning and scrolling.
