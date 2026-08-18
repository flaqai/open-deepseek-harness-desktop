# Post-mortem 0005: Empty gateway fragments erased tool-call identity

English | [中文](0005-openai-compatible-gateway-empty-tool-identity.zh.md)

Status: resolved

## Executive summary

An OpenAI Chat Completions-compatible gateway emitted a tool call's `id` and `name` in its opening streaming fragment, then sent empty strings for those fields in later argument fragments. The DeepSeek adapter treated the empty strings as updates and replaced the retained identity, so a valid `bash` call reached the runtime as `unknown tool ""`. The issue escaped because the streaming tests covered omitted fields but not empty placeholder fields. The adapter now accepts only non-empty identity updates, and a regression test reproduces the gateway framing.

## Summary

The desktop application showed `Error: unknown tool ""` for every attempted tool call. The model supplied plausible arguments, such as `pwd && ls -la`, but the executed tool record had an empty name and no schema.

The failure was not a missing tool registration, sandbox denial, or malformed tool arguments. The session event log showed that the opening `tool-call-delta` contained the expected `callId` and `name: "bash"`. Later streaming frames carried the arguments but represented the repeated identity fields as `""`. The adapter overwrote its accumulated block with those empty values before emitting the completed call.

## Impact

The affected model could not invoke any tool through this gateway. It repeatedly retried equivalent commands, consumed context, and left a confusing trail in the session trajectory. The user could not rely on the coding agent for inspection, editing, or command execution until the adapter was fixed and the desktop application restarted.

## Timeline

- A custom provider was configured against an OpenAI Chat Completions-compatible gateway and a DeepSeek model.
- The first tool request produced a valid `bash` identity in the opening streaming delta, followed by argument fragments whose `id` and `function.name` were empty strings.
- The completed tool-call event contained `id: ""` and `name: ""`; the runtime returned `Error: unknown tool ""`.
- Session-log inspection separated the model's initial valid tool identity from the adapter's later overwrite.
- The adapter was changed to retain an existing identity when a later fragment supplies an empty placeholder. The targeted translator test passed with the new framing, and the host library was rebuilt before restarting the desktop application.

## Root cause

OpenAI-compatible streaming APIs are not uniform about repeated fields. The adapter correctly preserved a prior value when a later delta omitted `id` or `function.name`, but it used only `!== undefined` as the update condition. For this gateway, an argument-only frame used `""` rather than omitting the field, so the adapter interpreted a placeholder as a new identity.

The completed tool call is assembled incrementally. Once the retained `callId` and tool name were replaced by empty strings, the runtime had no registered tool to resolve. The argument JSON remained valid, which made the visible payload look like a tool-runtime problem instead of a streaming-translation problem.

## Why safeguards missed it

The existing translator coverage exercised fragments in which later identity fields were absent. It did not model the equally valid compatibility behavior of sending empty-string placeholders. Manual diagnosis initially focused on tool availability because the final error named an unknown tool, while the decisive evidence was earlier in the streaming event sequence.

## Guardrails added

- `packages/llm/llm-deepseek/src/translate.ts` now updates a tool call's `callId` and `name` only when the incoming value is non-empty. A first fragment that has no identity remains invalid; the change only prevents later placeholders from erasing a known identity.
- `packages/llm/llm-deepseek/tests/translate.spec.ts` reproduces an opening `call_bash` / `bash` delta followed by empty-string identity placeholders and asserts that every emitted delta and the final block retain the original identity.
- The diagnostic workflow for `unknown tool ""` starts with the streamed tool-call deltas. It distinguishes a missing tool definition from an empty identity introduced during translation.

## Provider-side repair

The gateway must serialize an argument-only `tool_calls` delta by omitting `id` and `function.name`, not by emitting them as `""`. If it repeats those fields, their values must exactly match the opening fragment for the same `tool_calls[index]`.

Correct framing sends the identity once, then sends only arguments:

```json
{"tool_calls":[{"index":0,"id":"call_xxx","type":"function","function":{"name":"bash","arguments":""}}]}
{"tool_calls":[{"index":0,"function":{"arguments":"{\\"command\\":\\"pwd\\"}"}}]}
```

The second line must not instead include `"id":""` or `"function":{"name":""}`. The provider should use optional-field serialization such as `omitempty` or `undefined` for fields that are not present in a delta, and add an SSE regression test that joins the emitted frames and verifies the final tool identity is `call_xxx` / `bash`.

## Lessons

- For streaming protocols, omitted and empty fields have different compatibility meanings. State accumulation must preserve established identifiers unless a non-empty replacement is explicit.
- Diagnose the first malformed event, not only the final runtime error. The final tool payload can be syntactically valid while its identity was corrupted earlier.
- Compatibility tests should include both omitted fields and empty placeholders when gateways may serialize partial deltas differently.
