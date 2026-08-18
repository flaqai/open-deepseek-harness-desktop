# Agent Note: Inspiration collage paired skin

Status: implemented

English | [中文](2026-08-17-inspiration-collage-paired-skin.zh.md)

## Problem

Palette skins and chat backgrounds have separate state, persistence, and settings controls. That separation protects user-selected artwork, but a curated skin whose colors were designed around one illustration required two choices before the intended composition appeared.

## Decision

`ui-theme` ships the light `inspiration-collage` palette and the `idea-collage` WebP background. The palette derives accessible semantic state colors from the artwork's mint, teal, sky, coral, and yellow colors, while the background uses `focus-right` placement so the low-detail paper field remains behind the transcript and the collage stays at the outer edge.

The Appearance row marks this one skin with a paired background. Clicking its theme card calls the existing theme action and then the existing background action in the same gesture. ThemeRuntime remains unaware of the pairing: Host preference adoption, reconnects, and programmatic `setTheme()` calls never replace the browser-local background. The user can select another background afterward, and clicking the skin card again restores the curated pair.

The source artwork is authorized for redistribution with the project and is committed only as an optimized 1672×941 WebP asset. It never enters Host settings, session events, attachments, or model requests.

## Alternatives considered

- **Make every palette own a mandatory background:** rejected because existing users can combine any palette with any artwork, and a schema-level coupling would erase that choice.
- **Apply the background inside `ThemeRuntime.setTheme()`:** rejected because Host synchronization and reconnect adoption also reach the runtime preference and would unexpectedly overwrite a later browser-local background choice.
- **Keep the curated pair as two unrelated clicks:** rejected because the complete visual design would not appear when the user selects the named skin.
- **Store the source PNG as a custom local upload:** rejected because the skin is a shipped product choice that must work in both the desktop and browser applications without per-browser setup.

## Consequences

The settings UI has one intentionally paired gesture while palette and background state remain independently editable and independently persisted. The built-in schema gains one palette id and one background id, the default Web application serves one additional artwork path, and the visible collection contains eleven skins and eight shipped backgrounds.

Focused theme, background, bootstrap, and settings-row tests pin the ids, light color scheme, semantic colors, placement metadata, persistence, and two-action gesture. The assembled settings snapshot and responsive browser checks pin the visible card and artwork treatment.
