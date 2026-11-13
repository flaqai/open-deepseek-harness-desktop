---
description: "Reconciles retry inputs with NAS and LiveShare attribution without rewriting released history."
kind: persistence-change
---

# 2026-11-12-retry-principal-merge

English | [中文](2026-11-12-retry-principal-merge.zh.md)

## Summary

Join official retry-input and community NAS/LiveShare attribution histories. Four event roots retain retry and user caller metadata, owner/NAS/share-viewer principals, and optional subagent settlement stop reasons. Session format remains v4.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-12-retry-principal-merge
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-27-retry-control-input"
    mergedPrevious: ["2026-10-28-nas-liveshare-principal-merge"]
    after: "d970ef46142e411c6b3e4915eef548a2b5da132fa67dad7106e4920ff4a7ba23"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-27-retry-control-input"
    mergedPrevious: ["2026-10-28-nas-liveshare-principal-merge"]
    after: "675f1fb72388661aef0f084985d3f9a71f5ab37fcd6462df75e3a7852ab8f33e"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    mergedPrevious: ["2026-10-28-nas-liveshare-principal-merge"]
    after: "a064a7135f4f1dc159323d96f9e439cc63a569bd02f08a69b347937d4dc62e3d"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    mergedPrevious: ["2026-10-28-nas-liveshare-principal-merge"]
    after: "5c752a1b8120d97b336e4bc549298e3d7440d6485b141a64c858231b2e4224bf"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Both parent records and frozen formats remain unchanged. In the new-reader/old-data direction, historical user messages, queued inputs and title inputs retain their original source metadata; retry metadata is not required. In the old-reader/new-data direction, the existing producer-owned source contract preserves unknown nonempty kinds and arbitrary JSON attribution, including retry, NAS principals and optional settlement fields. Structural comparison in both directions still reports union changes requiring review; this acknowledgement records that review rather than suppressing it. Older UI may show an empty retry context row. Attribution is not authorization: the live device and sharing policies remain authoritative, and unknown stored principals grant no owner rights. No source logs are rewritten; this does not qualify historical binaries or resolve the known v0 summary refusal.

<a id="verification"></a>
## Verification

The merged snapshot is freshly extracted from current source. History validation must accept both parent chains and produce one tip for each of the four roots. Snapshot tests preserve parent bytes and digests and compare reader directions without hiding review-required differences. Native persistence tests open both plain and Zstd logs for read and write, preserve retry/user source metadata with all three principal forms and retain the source bytes. Native installed-client and historical-binary validation remain separate.

<a id="dev-note"></a>
## Dev Note

None.
