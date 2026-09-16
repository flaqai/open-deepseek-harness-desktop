# Agent Note: Frame-coalesced reasoning-chunk publication and browser stress validation

Status: implemented

English | [中文](2026-08-03-opt-in-reasoning-chunk-browser-stress.zh.md)

## Problem

Long reasoning streams continuously produce large numbers of process-local `assistant/live-chunk` updates before one durable settlement. Each update must remain ordered and be folded into the Assistant Definition to preserve live completeness, while the settlement embeds the exact stream for replay; React, however, needs only the current accumulated result, not every intermediate state within one browser frame.

Each `yield` in an async stream can create a new microtask boundary, so `Notifier.markDirty()` backed only by microtask batching degrades into rebuilding a `ConversationSnapshot`, notifying `useSyncExternalStore`, and running a React render for every chunk. Even with the live Think row collapsed, 100,000 reasoning chunks can overwhelm the main thread with reconciliation, commit, and layout work. The performance boundary must sit between session ingestion and React publication; it cannot hide the problem by slowing the producer or discarding raw events.

## Decision

The Session Controller preserves every provider chunk in the Host's durable Assistant stream but batches the Client-only presentation path before Conversation folding. Adjacent `text-delta`, `reasoning-delta`, and `tool-call-delta` entries for the same attempt, Turn, Step, and block are concatenated and appended to the event source once per animation frame; block boundaries, usage, finish, structural events, and settlements remain ordering barriers. Conversation then folds the compacted batch into each matching Definition State. Chat and Trajectory Definitions request `animation-frame` publication for visible `block-start`, text, reasoning, tool-call, and `block-end` changes, and the frame callback materializes one accumulated snapshot from the latest State. The durable `assistant/message` or `assistant/attempt` settlement publishes immediately and reproduces the exact original stream during history replay.

`Session` owns one pending presentation batch and `BoundConversation` owns one pending publication frame per Session. Ordinary structural events and durable settlements flush the presentation batch before applying their change; replacement baselines, resync, failure, and disposal discard obsolete partials. Both schedulers invalidate stale callbacks. Environments without `requestAnimationFrame` use a zero-delay timer for presentation batching, while Conversation keeps its immediate fallback. A settlement may skip one intermediate partial that has not yet appeared, while the published final content and durable embedded stream remain complete.

Keeping the live Think row horizontally pinned to the end of the accumulated text is purely visual alignment and does not require synchronous layout reads on every React commit. An in-component scheduler coalesces consecutive requests into one update every three frames, reads `scrollWidth` and `clientWidth` from the latest DOM, and updates `scrollLeft` directly to the latest position; the fixed visual cadence keeps summary changes readable without allowing browser smooth-scroll animations to accumulate. This throttling applies only to Think's horizontal summary and does not delay Chat body scrolling, history-prepend anchoring, or user-triggered `scrollIntoView`.

`pnpm run test:web:stress` remains keyless, opt-in browser performance evidence. The deterministic `?fixture` session emits 100,000 `reasoning-delta` events at a cadence independent of painting, and a terminal marker proves that the events cross production session reduction and reach the live Think row; a 50-millisecond heartbeat and a pre-scheduled DOM event measure main-thread stalls and interaction latency, respectively, with a 250-millisecond budget for identifying clear regressions. `DSH_WEB_STRESS_HEADFUL=1` lets developers profile the same scenario in a visible browser with the Performance panel. The stress lane is evidence for manual performance diagnosis and fix acceptance, not a default CI gate or a substitute for deterministic scheduling unit tests.

Focused tests pin presentation-delta concatenation, block and owner barriers, first-useful-token timing, `Notifier`'s per-frame coalescing, structural-event preemption, invalidated callbacks, and the no-rAF fallback. Session-level tests prove that 100 same-block chunks produce one event-source publication with complete accumulated text, and that settlement flushes pending content without a duplicate notification from a stale frame callback. Small fixture unit tests continue to pin input validation, external arrival pacing, concurrency rejection, exact event count, and terminal-marker delivery without bringing the 100,000-chunk workload into the default test suites.

## Alternatives considered

**React transitions, deferred values, or component throttling applied to snapshots.** Rejected: the session source would still notify `useSyncExternalStore` for every chunk, the React render has already occurred before a component decides to defer display, and multiple components consuming the same snapshot would each need to implement the strategy. Visual tail-following throttling for the Think summary occurs after snapshot publication and only reduces the frequency of synchronous layout; it does not implement the data-publication policy.

**Dropping or sampling live chunks before Definition folding.** Rejected: the live accumulated state would diverge from the durable embedded stream and could omit visible content. Concatenating adjacent deltas preserves their complete bytes and ordering semantics; sampling would not.

**Microtask batching alone.** Rejected: consecutive asynchronous `yield` operations can drain the microtask queue between adjacent chunks, making microtask batching approximate one notification per chunk.

**Pacing the test producer by animation frames.** Rejected: the producer would slow whenever rendering slowed, giving the page implicit backpressure absent from a real network stream and masking main-thread starvation.

**A live model or recorded HTTP byte stream.** Rejected: live models are nondeterministic, and an HTTP/SSE recording would not improve the target assertion. The in-memory fixture preserves individual asynchronous session events, production client reduction, and the React rendering path while controlling the workload and arrival cadence.

## Consequences

The event-source and `ConversationSnapshot` publication rates are bounded by the browser's paint rate, so Conversation and React handle at most one compacted same-block partial containing all received text per frame; structural events can still publish sooner. Transport ingestion, ordering, and durable logging still process every raw chunk, while browser-side Definition folding and cumulative string/array copying operate on the compacted presentation batches. The decision limits long-turn allocation growth without changing replay fidelity or pretending to remove raw-stream parsing cost.

Horizontal layout reads and writes for the collapsed Think summary run at most once every three frames, and each update moves the summary directly to the latest position; React still commits accumulated snapshots normally, and the summary returns to the first line at finalization. This local visual policy does not change the immediacy of body scrolling or user interactions.

The browser stress lane continues to provide a responsiveness signal from the real assembled application and an entry point for visible profiling, but hardware and scheduling differences make it suitable only as explicit performance evidence. Deterministic focused tests guard publication counts, accumulated content, and preemption order, while the default test lanes remain fast.
