---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-15-nas-device-principal

English | [中文](2026-10-15-nas-device-principal.zh.md)

## Summary

Extend user-message source attribution with a NAS device principal. The same optional source metadata appears in user/message, developer/message, agent/inbox/spliced and session/title-llm-request. Retain Session format v4.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-15-nas-device-principal
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "d50f42c2267691719042a831dfcba163ef975c20a578a2c2f12aabc1a230398b"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "81429146fbf4daac37257eb2d360db77a83a4a417c118d4cfeab9418408ffe75"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "70c0983333d696d1689f211aad2e8b7a5c864a05382ea7a173b73bf0abb37f30"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "cca4be11b50a9ce23c04a6eed81754847b3b48afe1e26a1acacdf1cc259fc978"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Historical sources without a principal and explicit owner sources retain their meaning. NAS device attribution is optional historical metadata, not a stored authorization grant: live Peer and credential policy determine permissions. The unchanged current v4 reader accepts and preserves NAS and unknown future attribution without promoting it to owner; this supports a same-version metadata extension. This is not a claim that every older SDK or binary with a closed application codec accepts the new union. No frozen historical format or source artifact is rewritten; the known v0 summary refusal remains unchanged.

<a id="verification"></a>
## Verification

The session-format-catalog current.spec.ts restoration suite passes six tests, including absent, owner, NAS and unknown-future principals through the real current-format restore path. It verifies source preservation and unchanged input JSON. The reader implementation has no community changes against the fixed alpha.3 tag. Separate live NAS permission tests exercise task ownership and deny forged authorization replies; historical attribution does not replace those checks. Legacy binary and cross-platform installed-client compatibility are not qualified by these tests.

<a id="dev-note"></a>
## Dev Note

None.
