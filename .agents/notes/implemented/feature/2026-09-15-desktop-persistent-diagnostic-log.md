# Agent Note: Desktop keeps a bounded diagnostic log across restarts

Status: implemented

English | [中文](2026-09-15-desktop-persistent-diagnostic-log.zh.md)

## Problem

Opening the Desktop log directory did not identify the file that contains a failure. Harness output lacked per-line time and source fields, while Electron main-process console failures remained only in the launching terminal. A restart therefore removed important context from the user's practical diagnostic path even though the existing Harness file itself used append mode.

## Decision

Desktop owns one fixed `harness.log` under its platform log directory. Each process lifetime appends start and end records containing a random session id, version, platform, architecture, package mode and PID. Desktop console output and supervised Harness stdout and stderr append to the same file with ISO timestamps, source labels and severity. Split subprocess chunks remain buffered until a complete line is available, and a final unterminated line is flushed when that Harness generation exits.

The logger removes common authorization headers, credential-bearing URL fields, user-info passwords and environment-style secret assignments before durable writes. One entry is limited to 64 KiB. At application startup, an 8 MiB current file rotates to `.1`; at most four rotated files remain. Rotation occurs before writers open the current file, and a logging or rotation failure is reported to the original console without terminating the operation being diagnosed.

The settings-header action opens the fixed current log instead of opening only its directory. If the current file does not exist, the established fallback opens the parent log directory.

## Alternatives considered

A fresh file on each startup makes one launch easy to inspect but loses the failure that caused a restart. An unbounded append-only file preserves history but eventually consumes uncontrolled disk space. Separate Electron and Harness files make source ownership obvious, but force users to guess which file explains a startup failure and split one event sequence across files.

## Consequences

Users can restart and still inspect prior startup context from the settings header. Rotated files preserve a bounded recent history, but this log is not a permanent audit archive. Failures before the Desktop main module initializes, abrupt storage loss and native crashes that cannot reach JavaScript may still require operating-system crash reports. The logger's pattern-based redaction reduces common credential exposure but does not make arbitrary plugin output safe to publish without review.

Focused tests cover line framing, timestamps, redaction, rotation, cross-restart append behavior, supervised startup failures and the settings action. Native packaged behavior remains part of the release platform matrix.
