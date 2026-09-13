# Agent Note: Forked session inbox isolation

Status: implemented

English | [中文](2026-09-13-forked-session-inbox-isolation.zh.md)

## Problem

A session fork preserves a contiguous event prefix through a completed turn and any following standalone events. An `agent/inbox/spliced` event in that prefix can represent a prompt queued for the parent's next turn. Replaying that event as active child state causes the child's first turn to claim the parent's queued prompt before the prompt submitted in the child.

## Decision

The inbox projection records the session's `inheritedEventCount` in its internal state and ignores inherited inbox splices whose sequence is below that offset. It retains those events in the child log, so history and sequence provenance remain intact. Inbox splices at or after the offset belong to the child and remain pending across resume.

The inbox projection uses `stateVersion: 2`. A persisted version-1 projection row is discarded and rebuilt from the session log with fork isolation, so a stale cache cannot restore inherited parent work.

## Alternatives considered

**End the fork prefix at `turn/end`.** This would remove the queued prompt, but it would also discard unrelated standalone state that the fork operation deliberately preserves after the completed turn.

**Delete or rewrite inherited inbox events.** This would break the exact contiguous parent prefix and make the child log disagree with its recorded inherited-event count.

## Consequences

An ordinary fork inherits conversation history but never inherits pending parent work. Forks of forks apply the same rule. A resumed child restores only its own pending input. Focused AgentLoop and Session Controller tests cover the direct fork path, nested forks, resume, and version-1 cache invalidation.
