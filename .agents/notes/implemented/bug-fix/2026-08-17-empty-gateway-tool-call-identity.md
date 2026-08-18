# Agent Note: Preserve tool identity across empty gateway stream fields

Status: implemented

English | [中文](2026-08-17-empty-gateway-tool-call-identity.zh.md)

## Problem

Some OpenAI-compatible gateways send a tool call's identifier and function name in its first streaming frame, then emit empty strings for those fields while streaming later argument fragments. Treating those placeholders as replacement values records an empty tool name and makes the tool runtime reject the call.

## Decision

The DeepSeek chat-completions translator updates a tool block's id and name only from non-empty wire values. Later empty placeholders preserve the identity already assembled for the same tool-call index, while a stream that never supplies an identity keeps the existing empty fallback behavior.

## Verification

The translator test covers a `bash` tool call whose later argument fragments carry empty id and name placeholders, and asserts that every emitted delta and the completed block retain `call_bash` and `bash`.

## Alternatives considered

**Require gateways to omit absent fields.** Rejected because the malformed-but-common empty-string convention can be normalized at the adapter boundary without changing the tool runtime.

**Reject any tool call with an empty later field.** Rejected because the first frame can establish a complete identity, so rejection would discard a safe and executable request.

## Consequences

Gateways that use empty placeholders no longer lose tool identity mid-stream. A tool call whose first available id or name is empty remains invalid at the existing downstream validation point.
