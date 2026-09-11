# Agent Note: Desktop exit requires observed process quiescence

Status: implemented

English | [中文](2026-09-08-desktop-process-quiescence.zh.md)

## Problem

Swallowing host-disposal failures allows Desktop to quit despite failed cleanup. Scheduling relaunch before disposal completes can create another writer while children of the previous generation still run.

## Decision

The lifecycle controller schedules relaunch only after disposal succeeds. Failure clears the pending quit, reports the error and restores the window for retry. The disposal owner propagates failures instead of discarding `allSettled` results.

The runtime's `process-control` entry reuses its platform process inspector. Desktop observes Harness descendants every two seconds. Harness and one-shot commands use the existing native Job/scope launcher when available, otherwise its process-group or tree fallback. The runner uses the selected Node executable, not Electron. Windows hides both the private runner and its piped target so background Profile work cannot create a console window. The Windows fallback accepts a parent-child relation only when the child's creation time is not earlier than the candidate parent's, preventing a stale parent PID from attaching an older unrelated process after PID reuse. Command completion always terminates and verifies the owned range; unconfirmed handles remain retained for shutdown retry. Observed identities remain owned after reparenting; cleanup stages TERM then KILL and verifies identity before signalling. Native owners prove their range empty before the observer sweeps remaining identities, avoiding a race that could kill the native runner before it reports quiescence.

An independent guardian uses the selected Node runtime and the same process-control implementation. Electron writes only opaque record ids, labels, explicit root identities and PID/start identities to an atomic versioned recovery journal. A clean shutdown tells the guardian to exit after the journal is removed. An unexpected IPC disconnect makes it adopt the identity-fenced journal and reclaim the old generation before deleting it. Desktop quarantines unreadable journals and legacy journals without explicit roots before Profile checks, retaining one `.rejected` evidence file while allowing startup to continue; a current journal whose exact owned identities cannot be stopped still fails closed.

Package operations are cancellable and default to a ten-minute maximum. Shutdown renders the real waiting, cooperative-stop, process-reclaim and Profile-check stages. Ten seconds of graceful cleanup precede a force tier and a five-second final proof. A surviving range, observer failure or remaining mutation lock blocks exit and restart. The resulting page offers logs and a cleanup retry; it has no force-restart bypass.

The optional persistent-service path requires a stable plugin name and version, service id, purpose and Host-computed launch fingerprint. Its first call records a pending request without launching. Approval is scoped to the Profile and exact declaration. Runtime identities are kept in a separate journal, sampled every two seconds, and cleared only after confirmed exit. Normal Harness disposal and Desktop identity recovery exclude approved persistent identities; revocation, plugin uninstall and data-directory switching stop them first. Both the normal inventory removal path and startup-recovery removal path fail closed before package mutation if service cleanup is uncertain. A live recovery identity prevents a second copy from being spawned and tells the plugin to reconnect through its stable protocol instead. On Windows the outer Desktop Job enables silent child breakaway, allowing ordinary subprocesses to enter their own Jobs and an approved persistent service to retain an independent range. Lifecycle approval grants no new capability. A plugin that bypasses the standard interface is still arbitrary trusted Profile code and does not gain persistence guarantees.

## Alternatives considered

Process names and command-line matching do not establish ownership. Direct-child exit does not prove descendants exited. A PID parent field alone also does not establish ownership after the original parent exits, because Windows can reuse that PID. Polling remains a compatibility fallback rather than a substitute for native managed ranges.

## Consequences

General Settings shows a redacted inventory with lifecycle, state, elapsed time and containment. It accepts opaque stop ids only. Pending persistent declarations require an explicit approval; approved declarations can be revoked, with runtime cleanup preceding removal of the permission. PIDs, argv, cwd and environment never cross the renderer bridge.

A fast-exiting observed root can disappear before identity registration; that uncertainty blocks cleanup rather than authorizing a guessed kill. Old code that detaches before the first observation can escape a process-table fallback. The implementation never kills by process name, port or command matching and does not claim to be a malicious-plugin sandbox.

Lifecycle, invocation, observer, guardian, authorization and UI tests cover failed cleanup retry, PID reuse, stale Windows parent PIDs, reparenting, unreadable and legacy journal quarantine, cancellation, timeout, fingerprint changes, duplicate-service rejection, persistent identity exclusion, redaction and explicit approval. A macOS host test verifies collection of an observed detached child and a local persistent-service fixture. Unit tests verify the Windows outer Job's silent-breakaway flag and private runner protocol, but native Windows/Linux persistence, packaged startup and abrupt native crash behavior remain release-blocking platform checks rather than inferred successes.
