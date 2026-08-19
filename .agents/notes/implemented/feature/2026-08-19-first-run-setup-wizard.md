# Agent Note: First-run setup wizard

Status: implemented

English | [中文](2026-08-19-first-run-setup-wizard.zh.md)

## Problem

The former first-run experience split an internal-testing notice and a DeepSeek-specific credential form across two blocking dialogs. It did not introduce the bundled messaging integration, gave no overview of remaining setup, and duplicated model-editing presentation instead of guiding users through the Settings pages they would use later.

## Decision

First entry on an empty Hero mounts one versioned setup wizard contributed through `settings.onboarding`. The selected layout is a wide, quiet Settings-like dialog with a dedicated three-step rail: connect a model, connect messaging, and ready. Its overview contains two tasks: configure a model API key, and configure WeChat or Feishu through the bundled `@xmanrui/dsh-im` plugin.

The wizard does not own either configuration form. A task calls the settings shell with a structured request naming the existing section, an optional feature-owned subsection, the progress step, and a completion callback. The shell renders that section inside the onboarding frame without the ordinary Settings navigation. That frame portals to `document.body`, outside the inert application root held by the overview modal, so its controls remain the sole interactive surface instead of clicks passing through to the task list. Models therefore keeps its existing editor, while messaging opens the existing Plugins section with `im` selected. Returning to the overview changes no task state; explicitly completing the page invokes the callback and paints a green completed state. A model already usable in the shared Models snapshot starts complete.

Each task can be skipped, and **Skip all** resolves both at once. Once both tasks have a result, an all-complete path shows **Configuration complete**; any skipped task shows **Ready to go** and points back to Settings for later completion. **Start using Harness** is the only durable completion action. It writes the bumped `ui-onboarding.welcomeNoticeVersion` on loopback deployments and uses the existing process-memory fallback for remote browsers. Per-task completion remains local until that final action, so abandoning the wizard does not record configuration that the Host cannot prove.

A compact language menu occupies the overview's top-right utility area. It reads the shared Locale snapshot and writes through `LocaleRuntime.setLocale`, rather than owning a wizard-only preference. The locale change therefore refreshes the wizard and any reused Settings section through the standard locale seat, uses existing Host persistence, and leaves the wizard's local task results intact.

## Alternatives considered

- **Keep two sequential blocking dialogs:** rejected because users cannot see the scope of setup, messaging remains undiscoverable, and one-off model presentation drifts from Settings.
- **Redraw model and IM forms inside the wizard:** rejected because it creates a second validation, persistence, accessibility, and plugin-lifecycle surface for the same settings.
- **Open the ordinary Settings modal and highlight its existing navigation:** rejected because unrelated choices distract from first-run setup and make return-to-progress behavior ambiguous.
- **Persist every task result immediately:** rejected because “completed” is currently an explicit user confirmation after a reused page, not a new Host capability result shared by Models and third-party IM configuration.

## Consequences

The settings onboarding owner contract now carries a structured section request, and settings sections may accept an optional preferred subsection. The shell owns only the reusable onboarding frame and footer; feature plugins continue to own their forms, facts, and mutations. The Plugins section follows a requested tab without changing its ordinary default behavior.

Focused component tests pin section routing, IM subsection selection, completion callbacks, green completed state, skip-all behavior, final acknowledgement, the already-configured model path, and the language selector's shared-locale write. The client contract typecheck and GUI unit suite cover the assembled slot change. Browser replay remains outside this change's local verification because this workspace intentionally does not run Playwright by default.
