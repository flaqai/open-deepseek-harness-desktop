---
description: "Reconciles NAS and LiveShare attribution without rewriting either released history."
kind: persistence-change
---

# 2026-10-28-nas-liveshare-principal-merge

English | [中文](2026-10-28-nas-liveshare-principal-merge.zh.md)

## Summary

Join the parallel NAS-device and LiveShare-viewer attribution histories. The resulting optional principal vocabulary retains owner, NAS device and share-viewer attribution in the same four event roots; Session format remains v4.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-28-nas-liveshare-principal-merge
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    mergedPrevious: ["2026-10-15-nas-device-principal"]
    after: "536aef107ab874332804d77b3d19fe4ed23ef4768c8ff34eb3311d46fde99c1f"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    mergedPrevious: ["2026-10-15-nas-device-principal"]
    after: "d9341ae94bda33eb37b5cd15b13f061865c9c8cb98c72cc2c3ccd771c3ba6b59"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    mergedPrevious: ["2026-10-15-nas-device-principal"]
    after: "1d062eda1c71c392cb9a61bb16a45e8cda4f77064b18db993ebb320b5eaafa04"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    mergedPrevious: ["2026-10-15-nas-device-principal"]
    after: "6b0fdfd57aa02edbb77bf2dd715105734ad689f788f6fe6b7981a848d50bfe44"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Both parent records remain immutable. The merge acknowledges every parent transition independently. Source principal metadata records attribution, not authorization: live NAS-device and share-viewer policies still decide access. Missing and unknown historical attribution remains preserved without granting owner rights. No source Session log or frozen format definition is rewritten. This acknowledgement does not qualify older binaries or the known v0 summary refusal.

<a id="verification"></a>
## Verification

The merged schema is extracted from current source. Persistence history validation must accept both parent paths and require a unique resulting tip; decoder tests cover both retained inline parent snapshots, digest rejection and unchanged source bytes. NAS and LiveShare protocol tests cover the independent live permission policies. Native installed-client and cross-platform acceptance remain separate.

<a id="dev-note"></a>
## Dev Note

None.
