# Agent Note: Frame-batched streaming publications

Status: implemented

English | [中文](2026-09-13-streaming-client-frame-publication.zh.md)

## Problem

Assistant stream frames can arrive faster than a display can paint them. The Client event feed already delayed Conversation rendering, but each transient frame also marked the complete Session snapshot dirty in a microtask. Pushed projection values used the same microtask path and caused the Session Manager to rebuild list rows repeatedly. A burst therefore performed subscriber and snapshot work for intermediate states that no screen could display.

## Decision

Transient Assistant frames mark the Session snapshot frame-dirty. Projection control frames mark their per-key and any-key channels frame-dirty. Each channel publishes the latest cumulative state at most once per animation frame. Projection baselines and truncation remain structural microtask publications, and Assistant settlement, lifecycle, queue, prompt, and controlled-input updates retain their existing timing.

The event feed still accepts every Assistant frame synchronously. This preserves dense-index validation, ordering, settlement matching, and the complete transient fold while removing redundant outer Session and list publications.

## Alternatives considered

**Disable streaming or reduce model output.** This would hide useful progress and change product behavior instead of removing redundant Client work.

**Throttle every Session mutation.** User gestures, durable settlements, lifecycle transitions, baselines, and recovery operations require prompt publication. Applying frame cadence to all mutations would weaken those timing contracts.

**Patch a smooth-rendering plugin.** The duplicate publications exist in the shared Client object layer and affect every composition. Third-party rendering can add work, but it does not own Session or projection notification timing.

## Consequences

Bursty token delivery produces one outer Session notification and one projection notification per subscribed channel per display frame. Consumers still observe the latest cumulative value, and structural state can supersede a pending frame publication. The change does not batch transport frames or skip validation. Tests pin burst coalescing, stale projection rejection, and structural supersession.
