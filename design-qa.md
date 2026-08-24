# First-run setup wizard design QA

## Evidence

- Source visual truth: `/Users/6677h/.codex/generated_images/01a00dbb-4ac5-71c1-b1cf-6dac671861f2/exec-804fd066-a2c5-4d32-b8bf-1933dd3ed3a0.png`
- Implementation screenshot: `/Users/6677h/StudioProjects/flaq-deepseek-harness/open-deepseek-harness-desktop/onboarding-implementation-fixed-1487x1058.png`
- Full-view comparison: `/Users/6677h/StudioProjects/flaq-deepseek-harness/open-deepseek-harness-desktop/onboarding-design-comparison.png` (source left, implementation right)
- Responsive evidence: `/Users/6677h/StudioProjects/flaq-deepseek-harness/open-deepseek-harness-desktop/onboarding-implementation-640x900.png`
- Reused Models-page evidence: visually inspected in the same local browser session before returning to the overview.
- Viewport: 1487 × 1058 CSS px for the normalized comparison; 640 × 900 CSS px for the narrow state.
- Pixels and density: both normalized full-view images are 1487 × 1058 pixels at device scale factor 1; no resampling was needed. The combined comparison is 2974 × 1058 pixels.
- State: first-run task overview, Chinese locale, light theme, neither task complete. Additional states inspected: Models configuration page, return without completion, green model completion, skipped-message final welcome, and narrow responsive layout.

## Findings

- No actionable P0/P1/P2 visual differences remain.
- Typography follows the product's existing system font, weights, sizes, and line-height hierarchy. The implementation is slightly more compact than the ideation image but preserves the same title, supporting copy, task hierarchy, and readable wrapping.
- Spacing and layout preserve the wide modal, dedicated progress rail, two separated task rows, generous quiet canvas, and stable footer. The production rail is intentionally narrower to match the existing Settings shell proportions.
- Colors use existing semantic tokens. The quiet white/gray surface, business-primary active step, and success-green completion state retain sufficient contrast in both inspected widths.
- The design uses the product's existing icon library rather than generated or approximate assets. Icons remain sharp and aligned at the rendered sizes.
- Copy matches the requested flow: API key, WeChat/Feishu through `xmanrui/dsh-im`, per-task skip, skip all, completion progress, and final welcome.
- The top-right language selector occupies the former utility gap without competing with the close action. Its self-named Chinese and English choices use the existing menu primitive, switch the entire shell immediately, and preserve the wizard's current task results.
- The ideation image's bottom **Next** button is intentionally absent. The shipped interaction advances only through explicit task completion or skip and shows the welcome automatically once both tasks have a result, avoiding a redundant enabled-state rule.

## Focused comparison

A separate crop was not needed: at matched 1487 × 1058 dimensions the rail labels, task typography, icons, pills, borders, and actions are all legible in the full-view comparison. The Models-page and 640 × 900 captures provide the additional interaction and responsive evidence.

## Comparison history

1. Initial browser inspection found a P0 interaction issue: the reused Settings frame rendered under the overview's inert application root. Semantic automation could target its labels but the real pointer surface could pass through to the underlying wizard.
2. The Settings frame was moved to a `document.body` portal, matching the modal ownership boundary, and a component assertion now pins that placement.
3. Post-fix evidence confirmed that **Back to steps** returns with both tasks unresolved, **Complete step** returns with a green model check, and the narrow layout keeps every primary control visible.

## Interaction and runtime checks

- Tested: open Models, return without completion, reopen Models, complete the task, skip the messaging task, reach the final welcome, switch the live shell from Chinese to English through the top-right menu, retain task progress across that switch, and render at 640 × 900.
- Console checked: the fresh temporary Host emitted an existing transient `appShell service missing after settled` message during boot/reload before the composed UI recovered; no interaction-specific exception appeared during the tested onboarding flow.

## Follow-up polish

- P3: if a future design pass wants exact mock proportions, the rail may grow from 250px toward 300px and the modal toward 1160 × 840px. Current proportions intentionally align with existing Settings geometry and do not reduce usability.

## Better Sidebar deferred-install card design QA

- Reference: selected Product Design option 3 (`exec-319684e4-0aea-4610-9395-51859add8769.png`), 1680 × 945.
- Implementation capture: `/private/tmp/better-sidebar-qa-final.jpg`, normalized to the same 16:9 state.
- Combined comparison: `/private/tmp/better-sidebar-comparison.jpg`.
- Browser preview: `http://127.0.0.1:4180/` using the production React component with an extraction-stage fixture.

## Visual checks

- Bottom-right placement, card hierarchy, 16 px corner treatment, restrained shadow, stage rail, 46% progress, and two-action footer match the selected direction.
- Accent color uses the existing DeepSeek information-blue token instead of introducing a standalone palette.
- Width remains bounded at 440 px and collapses to a 12 px mobile inset below 640 px.
- Chinese copy remains legible without truncation at the validated 1280 × 720 viewport.

## Functional checks

- The native progress element exposes progress semantics and the card uses polite live-region updates.
- “隐藏” removes the card without invoking cancellation; the background poll remains owned by the mounted component.
- Success returns the card with “稍后” and the narrow application-restart action.
- Failure returns the card with retry and the existing fixed Harness-log action.
- Browser console check reported no errors; focused component, bridge, installer, and slot tests passed.

final result: passed
