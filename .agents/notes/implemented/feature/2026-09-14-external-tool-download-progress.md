# Agent Note: External-tool download progress stays observational

Status: implemented

English | [中文](2026-09-14-external-tool-download-progress.zh.md)

## Problem

Desktop users installing Codex or Claude Code could see only an undifferentiated busy action until the guarded Profile mutation completed. A slow registry or retry looked frozen, while opening more diagnostics was possible only after failure.

## Decision

The existing guarded installer remains the sole owner of mutation, retry, timeout, quarantine, and failure decisions. For its main pnpm step, the CLI may write NDJSON to a Host-created mode-0600 sidecar inside the selected DSH home. The Host parses that stream into coarse stages, exposes a percentage only after pnpm finalizes the resolved dependency count, retains a bounded sanitized terminal transcript, and serves increments by Host-issued install id plus opaque byte offset. It never exposes the sidecar path to the renderer, and it removes the file when the operation settles or the next startup finds it stale.

Desktop plugin mutations install into a staged candidate DSH home before activation. During that stage, the CLI validates the sidecar against the guarded transaction origin rather than the temporary candidate home. The origin is accepted only when the selected home has the exact `plugin-transactions/<profile>/<uuid>/candidate` relationship for the active Profile; arbitrary progress paths and unrelated origins remain rejected.

The External tools page renders the reported state inside the existing install action and opens the transcript through a separate secondary action. Once dependency resolution fixes the total, download progress uses acquired dependencies and installation progress uses pnpm's imported dependencies, so a fast or cache-heavy download still exposes a truthful percentage instead of skipping directly between indeterminate stages. Closing the transcript does not cancel installation, and a stalled percentage does not create a new failure condition.

Successful installation does not activate the new connection automatically. The completed card becomes a user-controlled **Restart to enable** action backed by the narrow Desktop restart bridge; it never reruns the installer and never restarts before the user clicks it.

While installation is running, the progress action is split into **Pause** and **Stop**. The subprocess capability has no portable suspend verb, so Pause does not claim to freeze a live operating-system process. Both actions terminate the exact Host-issued install's managed process range and wait for it to become empty. Pause retains a resumable UI state; Resume starts the same guarded request again and lets pnpm reuse its content-addressed cache. Stop retains a cancelled state and never resumes by itself. The renderer can submit only the opaque install id, never a PID or signal.

## Alternatives considered

**Assign fixed weights to every phase.** Resolution and lifecycle scripts have no truthful shared duration. Weighted progress would look precise while being fabricated.

**Return the whole transcript with every install snapshot.** Repeated transport would grow with the install and couple ordinary status polling to sensitive raw subprocess output.

## Consequences

Users can distinguish preparation, dependency resolution, download, installation, and verification, inspect retries while they happen, and retain the existing diagnostic after failure. Cached packages count as acquired dependencies, and imported package counts keep a determinate percentage visible through installation. Windows retry starts reset determinate progress rather than preserving a stale percentage. Progress observation is optional: failure to create the private sidecar cannot block the installation itself. Activation remains an explicit user decision.
