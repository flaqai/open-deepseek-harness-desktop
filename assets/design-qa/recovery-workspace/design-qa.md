# Desktop recovery workspace design QA

## Evidence

- Source visual truth: `/Users/6677h/.codex/generated_images/01a0128d-e557-74d3-b31e-841486ddfc1f/exec-7aa81eeb-9c02-442f-a300-dbe4bf15c7f0.png`
- Recovery-home implementation: `/Users/6677h/StudioProjects/flaq-deepseek-harness/open-deepseek-harness-desktop/.artifacts/recovery-design-qa/recovery-implementation-home-1715x917.png`
- Plugin-manager implementation: `/Users/6677h/StudioProjects/flaq-deepseek-harness/open-deepseek-harness-desktop/.artifacts/recovery-design-qa/recovery-implementation-plugins-1715x917.png`
- Full-view comparison: `/Users/6677h/StudioProjects/flaq-deepseek-harness/open-deepseek-harness-desktop/.artifacts/recovery-design-qa/recovery-design-qa-comparison.png`
- Focused plugin comparison: `/Users/6677h/StudioProjects/flaq-deepseek-harness/open-deepseek-harness-desktop/.artifacts/recovery-design-qa/recovery-design-qa-plugin-focus.png`
- Viewport: 1715 x 917 CSS px, light theme, Chinese locale, startup-failure/recovery state.
- Pixels and density: source and both implementation captures are 1715 x 917 pixels at device scale factor 1. The design source is a board containing two smaller window states, so the comparison preserves its full board and judges hierarchy and interaction structure rather than treating those embedded windows as a pixel-exact production viewport.

## Findings

- No actionable P0/P1/P2 differences remain.
- Typography uses the product system font and retains the design's title, supporting copy, tab, table, and footer hierarchy. Text remains readable without truncation at the inspected viewport.
- Spacing and layout preserve the paused startup context, two-by-two recovery home, four persistent peer tabs, right-aligned row actions, and stable Continue/Quit footer. The production shell uses a 1040 px readable maximum width instead of stretching sparse recovery content across an ultrawide window.
- Colors follow the selected cool white/gray direction. Blue is reserved for progress, links, the active tab, and Continue; destructive plugin removal uses a filled semantic red.
- Image quality and assets are sound: the actual packaged application icon is reused at native size and remains sharp. The source card glyphs were intentionally omitted rather than approximated with inline SVG, CSS drawing, or text symbols; the cards remain distinguishable by titles and actions.
- Copy matches the agreed model: all four tools are independent, no previous-step language appears, and users may Continue without changing anything.
- The implementation exposes more accurate plugin evidence than the visual source: diagnosed rows show the diagnostic code, while healthy rows show their installation-source class. This is an intentional product improvement rather than design drift.

## Focused comparison

The focused table comparison confirms that the four tabs remain available after entering Plugin manager, each plugin has one filled red Uninstall action on the far right, protected core components are separated from removable dependencies, and the footer stays available below the tool content.

## Comparison history

1. The first real Electron capture showed one stale development-entry sentence telling users to choose Retry even though the new primary action is Continue.
2. The main-process recovery-entry copy and both Settings locales were changed to Continue.
3. Post-fix Electron captures show the recovery home and plugin manager with the same paused-startup header, independent navigation, and consistent Continue action. No P0/P1/P2 mismatch remained.

## Interaction and runtime checks

- A real development Electron instance opened Settings and entered the production recovery page.
- Verified the four home cards, direct peer-tab navigation, plugin inventory rendering, per-row Uninstall buttons, error-detail disclosure, persistent footer, and Continue-without-changes affordance.
- The capture fixture exercised both home and plugin states with main-process IPC responses; focused Vitest covers the narrow plugin inventory and package-name boundary.

## Follow-up polish

- P3: card glyphs could be added later if a packaged, approved icon set is introduced for the standalone loading page. They are not required for comprehension and are deliberately not approximated.

final result: passed
