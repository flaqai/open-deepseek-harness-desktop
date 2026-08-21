# Agent Note: Direct DeepSeek vision input

Status: implemented

English | [中文](2026-08-19-direct-deepseek-vision-input.zh.md)

## Problem

DeepSeek vision deployments use the chat-completions image protocol, but the direct `deepseek-official` adapter declares every catalog and pass-through model text-only and rejects every `ImageBlock`. The durable attachment path therefore works only through configurable pi-ai routes, and a deployment cannot pass user uploads or image-bearing tool results through the direct provider.

## Decision

The direct adapter lets a configured model opt in with `inputModalities: [text, image]`; validation rejects empty, unknown, or duplicate modalities. Flash, Pro, unlisted ids, and configured models that omit `inputModalities` remain explicitly text-only. The shipped catalog does not advertise `deepseek-v4-flash-vision-exp` until its model endpoint is ready, so the model selector cannot offer an unavailable route; deployment and snapshot catalogs can enable their exact vision model independently.

The adapter resolves `ctx.attachments` per image request, reads each retained durable reference with the request signal, and serializes verified bytes as ordered OpenAI-compatible `image_url` data URLs. Text-only user messages retain string content. Tool results retain string-only `tool` messages; image-only results use `(see attached image)`, and consecutive retained tool-result images follow in one `user` message beginning `Attached image(s) from tool result:`. System and assistant history images fail with `UNSUPPORTED_CONTENT` before attachment or network I/O.

The direct adapter and pi-ai conversion share the deterministic [request-level image payload bound](../bug-fix/2026-08-18-request-image-payload-bound.md). Both default to 20 MiB of accumulated base64 payload, replace oldest image occurrences with the same fixed placeholder, and never read omitted attachments. Direct HTTP 413 responses are `INVALID_REQUEST`; attachment failures retain their stable attachment code rather than becoming `TRANSPORT`.

Canonical messages continue to store only `ImageAttachmentRef`. Data URLs exist only while preparing one provider request, so no session event, persistence format, API schema, or SDK projection changes. The route accepts PNG, JPEG, WebP, and GIF already admitted by the attachment service. External image URLs, the Files API, and image output remain unsupported.

## Alternatives considered

- **Use only the pi-ai DeepSeek provider.** Its generic multimodal path proves the content conversion, but it does not make the direct official route truthful or usable with the official model id.
- **Declare the whole provider image-capable.** This would let Flash, Pro, and unknown pass-through ids accept durable images that their exact wire model cannot promise to consume. Capability remains exact-model metadata.
- **Send images inside `tool` message content.** The documented compatible form keeps tool content a string. A following user message avoids relying on an undocumented multimodal tool-role form while preserving call-result order.
- **Add external URLs or Files uploads.** Both require new canonical input, authorization, lifetime, cleanup, and replay decisions. Transient base64 uses the existing durable attachment contract without expanding those concerns.

## Verification

Package tests pin model discovery and fallback capabilities, configuration validation and live settings updates, user and tool-result wire messages, all admitted MIME types, cancellation, attachment failures, 413 classification, exact image-bound behavior, and pi-ai equivalence. A keyless assembled ACP request records the native adapter's tool-result data URL and oldest-image placeholder.

## Consequences

Configured DeepSeek vision routes can consume durable user and tool-result images without changing session durability or response streaming. Repeated history still expands request bodies, but deterministic oldest-first offload bounds the dominant payload and leaves headroom below the official 30 MiB request-body limit. Image token pricing remains provider-owned because the official image token formula is not available.
