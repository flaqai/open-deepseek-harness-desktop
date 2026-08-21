# Agent Note: 直接 DeepSeek 视觉输入

Status: implemented

[English](2026-08-19-direct-deepseek-vision-input.md) | 中文

## Problem

DeepSeek 视觉部署使用 chat-completions 图片协议，但直接 `deepseek-official` 适配器把所有 catalog 与原样传递模型都声明为仅文本，并拒绝每一个 `ImageBlock`。因此，持久附件路径只能经可配置 pi-ai 路由工作，部署方无法通过直接提供方传递用户上传或包含图片的工具结果。

## Decision

直接适配器允许已配置模型通过 `inputModalities: [text, image]` 选择加入；校验会拒绝空列表、未知模态或重复模态。Flash、Pro、未列出 id，以及省略 `inputModalities` 的已配置模型仍明确仅支持文本。在模型端点就绪前，随附目录不会公布 `deepseek-v4-flash-vision-exp`，因此模型选择器不会提供不可用路由；部署与 snapshot 目录可以独立启用其确切视觉模型。

适配器会对每个图片请求解析 `ctx.attachments`，用请求 signal 读取每个保留的持久引用，并将校验后的字节按顺序序列化为 OpenAI 兼容的 `image_url` data URL。纯文本 user 消息保留字符串内容。工具结果保留仅字符串的 `tool` 消息；仅含图片的结果使用 `(see attached image)`，连续工具结果中保留的图片随后合并进一条以 `Attached image(s) from tool result:` 开头的 `user` 消息。System 与 assistant 历史图片会在附件或网络 I/O 前以 `UNSUPPORTED_CONTENT` 失败。

直接适配器与 pi-ai 转换共享确定性的[请求级图片载荷上限](../bug-fix/2026-08-18-request-image-payload-bound.md)。两者都以 20 MiB 累计 base64 payload 为默认值，用相同固定占位文本替换最旧的图片出现位置，并且绝不读取被省略的附件。直接 HTTP 413 响应归类为 `INVALID_REQUEST`；附件失败会保留其稳定附件 code，不会变成 `TRANSPORT`。

规范消息继续只存储 `ImageAttachmentRef`。Data URL 只在准备单次提供方请求时存在，因此无需修改会话事件、持久化格式、API schema 或 SDK 投影。路由接受已经由附件服务准入的 PNG、JPEG、WebP 和 GIF。不支持外部图片 URL、Files API 和图片输出。

## Alternatives considered

- **只使用 pi-ai DeepSeek 提供方。** 其通用多模态路径验证了内容转换，但无法让直接官方路由如实公布能力，也无法让它配合官方模型 id 使用。
- **把整个提供方声明为支持图片。** 这样会让 Flash、Pro 和未知的原样传递 id 接受持久图片，但其确切协议模型无法承诺消费这些图片。能力仍属于确切模型元数据。
- **在 `tool` 消息内容中发送图片。** 已记录的兼容形式要求工具内容保持字符串。随后发送 user 消息可避免依赖未记录的多模态 tool role 形式，同时保留调用结果顺序。
- **增加外部 URL 或 Files 上传。** 两者都需要新的规范输入、授权、生命周期、清理和重放决策。瞬态 base64 可以复用现有持久附件约定，不扩展这些问题。

## Verification

包测试固定模型发现与回退能力、配置校验与存活 settings 更新、user 和工具结果协议消息、所有已准入 MIME 类型、取消、附件失败、413 分类、确切图片上限行为和 pi-ai 等价性。无需密钥的组装 ACP 请求会记录原生适配器的工具结果 data URL 与最旧图片占位文本。

## Consequences

已配置的 DeepSeek 视觉路由可以消费持久 user 与工具结果图片，而无需改变会话持久性或响应流。重复历史仍会扩张请求正文，但确定性的最旧优先 offload 会限制主导 payload，并在官方 30 MiB 请求正文上限下保留余量。由于官方图片 token 公式尚不可用，图片 token 定价仍由提供方掌握。
