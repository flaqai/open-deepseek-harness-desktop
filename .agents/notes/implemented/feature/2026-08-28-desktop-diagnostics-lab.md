# Agent Note: Desktop Diagnostics Lab

Status: implemented

English | [中文](2026-08-28-desktop-diagnostics-lab.zh.md)

## Problem

The production Profile doctor protects startup, but support still needs a repeatable way to show how dependency conflicts, orphaned Bundles, Loader failures, and blocked builds are detected and handled. A transient pressure test is not useful for that demonstration: once one pass succeeds, repeating the same fixed fixture adds little evidence, and automatic cleanup removes the issues before the normal Diagnostics summary or quarantine actions can be inspected.

The exercise must remain safe. The renderer must not gain an arbitrary package manager, path, script, or filesystem capability, and a deliberately retained exercise must not be confused with an interrupted write that should be rolled back before startup.

## Decision

The desktop host owns a versioned Diagnostics Lab behind a narrow Electron bridge. Its catalog contains fifteen fixed scenario identifiers and fixed fixture bytes: compatible and incompatible Host shadows, orphaned Bundles, legacy quarantine-removal residue, a scoped-root versus unscoped-Loader package-name mismatch, a resolvable Loader with a missing internal dependency, an invalid settings document, the packaged `dsh-font` client incompatibility, missing modules, invalid patches, duplicate Loader rows, lifecycle failures, blocked build approval, interrupted repair, and a bounded startup-operation timeout. The renderer can select only those identifiers and either an isolated sandbox or an explicitly confirmed current-Profile target. No scenario is selected by default.

Every selected scenario is injected exactly once. A successful run ends in the durable `active` phase rather than cleaning itself. The run-specific files, package-manager state, repair disposition, and quarantine records remain available until the user chooses **Restore all**. Reports retain expected and actual product codes, repair disposition, duration, and bounded redacted diagnostics.

The default sandbox uses a run-specific home under Electron `userData`. It exercises the production Doctor boundary and retains its runtime, but it cannot affect the active Profile summary. This is intentional: sandbox evidence is visible in the Lab card and report, not presented as a real user Profile problem.

Current-Profile mode is restricted to eight scenarios backed by real product paths: compatible Host shadow, incompatible Host dependency, orphaned Bundle, legacy quarantine-removal residue, scoped Loader package-name mismatch, missing Loader dependency, invalid `settings.yaml`, and the packaged `dsh-font 1.1.0` client incompatibility. Harness pauses while the desktop host backs up the allowlisted Profile manifest, Workspace policy, lockfile, patch, user settings, safe-mode settings, quarantine record, and retained health reports. Host-shadow samples are installed only beneath their namespaced `@dsh-diagnostic-lab/*` root; they never replace the Profile-wide Host override or change `nodeLinker`. The first four fixtures still use the production `dsh plugin --profile web doctor --repair` path. The quarantine-removal exercise recreates the exact inconsistent shape left by an older uninstaller: the plugin, active manifest entry, and durable quarantine are absent, while bounded repair, diagnostic, and lockfile references remain. The production Doctor must report `profile.quarantine-removal-residue`, remove only that derived state, and preserve unrelated incidents. The `dsh-font` fixture is an integrity-pinned `diagnostic` resource: normal startup and manual bundled-plugin flows never seed it. The Lab alone installs it through `dsh plugin add`, resumes the real browser, and waits for the client Loader recovery to record `profile.module-resolution`, remove the active Bundle, and quarantine the plugin. The ordinary Diagnostics summary therefore observes the same record that protects a real user startup.

The scoped-name scenario installs the integrity-pinned `@dsh-diagnostic-lab/scoped-loader-mismatch@1.0.0` resource through the ordinary plugin CLI. Its root package is scoped while its Bundle Patch deliberately names a nonexistent unscoped Loader module. The post-install Profile preflight must attribute that final entry to the unique direct root, quarantine it immediately as `loader-module-unresolvable`, and retain the real Diagnostics count and resolution actions. The same package runs under a run-specific DSH home in sandbox mode, so its quarantine cannot alter the active Profile.

The missing-dependency scenario similarly installs the integrity-pinned `@dsh-diagnostic-lab/loader-dependency-unavailable@1.0.0` package, but its Loader entry resolves and then statically imports a nonexistent internal Host module. The same preflight must report `loader.dependency-unavailable`, attribute it to the aggregate root, and quarantine it as `loader-dependency-unavailable`. The invalid-settings scenario writes duplicate keys to the selected home, retains the exact bytes, and in current-Profile mode resumes the real Harness until the safe-mode report records `config.settings-invalid` with `skippedUserSettings: true`. It verifies the installation-owned empty settings document without replacing the invalid user document. Browser-recovery scenarios run at the end: `dsh-font` first, then invalid settings, so one retained settings failure cannot mask the client-module exercise. Restore all returns the exact original settings bytes and removes a safe-mode document that did not exist before the run.

The startup-operation timeout scenario is sandbox-only and invokes a desktop-owned fake CLI that writes a private marker and keeps running. The same production `DesktopOperationSupervisor` applies a shortened exercise deadline, terminates the process tree, returns the structured timeout result, removes the marker as the simulated rollback, and proves the runner can continue to the next step. It never opens or mutates the active Profile and does not wait for production timeout durations.

The recovery journal distinguishes four states. `injecting` and `restoring` are incomplete transactions and are rolled back before Profile plugins load after a process interruption. `active` is an intentional retained exercise and is reattached to the UI after restart. `clean` means Restore all completed. This prevents crash recovery from erasing a deliberate demonstration while still failing closed on a half-written mutation.

Restore all is an explicit transaction. For the current Profile it pauses Harness again, restores the backed-up managed files, removes only the Lab namespace, fixed fixture source directory, namespaced installed roots, and run-attributed pnpm links, then performs an offline forced dependency rebuild. It re-applies and hashes the exact backed-up bytes, checks that no run-specific path or symlink remains, and runs a final read-only Doctor before marking the journal clean. Harness resumes only after all of those checks succeed. A failed restore stays retryable, blocks another exercise, and leaves Harness stopped; on the next launch the desktop records the failed recovery for the UI and continues into supervised safe mode instead of terminating the app. Safe-mode bare imports use a proper `file:` base URL. For a sandbox, restoration removes only that run's runtime. Cancellation or an assertion failure rolls back automatically because no valid exercise state was established.

## Alternatives considered

**Keep quick, standard, and soak presets.** Rejected because repeating immutable fixtures one, three, or ten times does not improve the user-facing diagnosis after the first successful pass and makes the exercise feel like an unrelated benchmark.

**Always auto-clean after verification.** Rejected because users cannot inspect the quarantine count, try the ordinary repair or uninstall actions, or capture the actual diagnosed state.

**Project sandbox issues into the active summary.** Rejected because that would make synthetic sandbox state look like a real Profile fault. Only current-Profile mode may change the ordinary summary.

**Offer every fixture against the current Profile.** Rejected because malformed patches, lifecycle failures, and controlled interruptions are classifier/recovery fixtures rather than package-manager-owned Profile plugins. They remain sandbox-only.

**Expose arbitrary packages or scripts to make more examples.** Rejected because it would turn a diagnostics UI into a general code-execution bridge. The catalog, bytes, package names, and target paths remain desktop-owned.

## Consequences

The Lab now demonstrates a persistent state rather than a pressure loop. Users can see real quarantine counts in current-Profile mode, use the existing Diagnostics actions on those plugins, restart the application without losing the exercise, and return to the exact pre-exercise managed configuration through Restore all. Sandbox runs remain fully isolated and therefore do not pollute the top summary.

The Electron main process owns the active run and a schema-2 journal/report. The `current` bridge operation reconnects a reloaded renderer, and the root `shell.overlay` card shows injection progress, retained state, pass/failure counts, and Restore all. Hiding the card changes only presentation.

Focused coverage pins single injection, default-empty selection, the absence of Profile-wide Host overrides in fixtures, durable sandbox state, real current-Profile quarantine visibility, legacy removal-residue staging and bounded cleanup, forced dependency restoration, clean-journal residue recovery, fail-closed restart behavior, valid safe-mode module URLs, restart reattachment, startup process-tree timeout and simulated rollback, cancellation rollback, report redaction, the restricted preload bridge, Settings presentation, and type-safe locale ownership. Browser replay and Playwright are not part of this desktop capability's verification lane.
