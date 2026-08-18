# Agent Note: Whale skins and browser-local chat backgrounds

Status: implemented

English | [中文](2026-08-16-whale-skins-and-chat-backgrounds.zh.md)

## Problem

The desktop application exposed only light, dark, and system appearance choices. Users could not choose a product skin or personalize the conversation with artwork without changing repository CSS. Treating an uploaded image like an attachment or Host setting would also put private decorative data on model or server paths that do not need it.

## Decision

`ui-theme` ships seven complete product skins—`ocean`, `moonlight`, `bubble`, `starlight`, `pirate`, `shinobi`, and `rift`—beside the existing palette preferences. They remain ordinary `ThemeDefinition` entries and persist through `ui-theme.preference`, so every UI package continues to consume semantic tokens instead of skin-specific selectors.

Chat background state and persistence are independent from the palette. The default Web application owns three original whale WebP assets and five original subject-led assets. A background may carry `focus-left` or `focus-right` placement metadata; ui-layout is the only DOM writer, and ui-conversation keeps the work area over the low-detail field while exposing the subject along the named outer edge. Narrow layouts replace the edge treatment with a stronger uniform readability veil. The [`inspiration-collage` curated pairing](2026-08-17-inspiration-collage-paired-skin.md) lets one settings-row gesture choose a matching palette and background without coupling their runtime or persistence paths.

A custom PNG, JPEG, or WebP is decoded and downscaled in the browser, encoded as a bounded WebP data URL, and retained in browser-local storage. The source and encoded sizes are capped. The custom image never enters Host settings, session events, attachments, or model requests.

## Alternatives considered

- **Store uploads in `$DSH_HOME/settings.yaml`:** rejected because large binary strings would inflate a human-editable shared settings document and move decorative private data across the Host API.
- **Apply background styles directly from the React settings row:** rejected because it would create a second DOM writer beside ui-layout's ThemePresenter and lose restoration on reload.
- **Create a desktop-only theme implementation:** rejected because the Electron application renders the same Web client; a shared client plugin preserves browser and desktop behavior without duplicate state.
- **Reuse existing DeepSeek brand artwork:** rejected because the project needs redistributable MIT-compatible assets with clear provenance. The shipped whale illustrations are original project assets and contain no copied logo.
- **Bundle artwork from named animation or game franchises:** rejected because character art, costumes, logos, and other recognizable expression cannot be redistributed under the project's MIT license. The four additional backgrounds are original genre treatments without copied characters, names, emblems, maps, or team marks; users may still upload artwork they are authorized to use.

## Consequences

Users gain eleven palette choices, eight shipped artwork backgrounds, and one local custom background while all conversation and model behavior remains unchanged. Custom images do not roam between browsers and disappear when browser storage is cleared. GIF and SVG sources are not accepted, and the default application must continue serving the eight paths under `/theme-backgrounds/`.

Focused tests cover palette registration, background persistence, settings actions, DOM projection, and retraction. The assembled Web snapshot and a real-server browser recording cover the visible selection flow.
