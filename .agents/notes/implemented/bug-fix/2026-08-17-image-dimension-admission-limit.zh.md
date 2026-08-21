# Agent Note: 图片单边尺寸准入上限

Status: implemented

[English](2026-08-17-image-dimension-admission-limit.md) | 中文

## Problem

`read_image` 在字节数与总像素之外没有任何尺寸检查，就把图片持久提交并追加进会话历史。已部署的模型路由在请求携带多张图片且其中任何一张单边超过 2000px 时会以 HTTP 400 拒绝整个请求。已接纳的图片会随该会话之后的每次请求发送，因此一次超限读取就毒化了持久历史：下一次模型请求失败，之后的每次重试同样失败，会话被永久杀死。其他图片来源（宿主上传、MCP 工具图片）存在同样的缺口，因为准入完全没有单边上限。

## Decision

`ImageAttachmentLimits` 增加 `maxImageDimension`，在准入完整解码（`detectImage`）中以 `IMAGE_DIMENSION_TOO_LARGE` 强制执行，因此所有经附件服务提交的来源都会在任何内容进入持久历史之前拒绝超限图片。`LocalAttachmentStore` 将其暴露为 `maxImageDimension` 配置项，默认值 `DEFAULT_MAX_IMAGE_DIMENSION = 2000`，即已部署路由强制执行的最严格单边上限；路由更宽松的部署可在 cordis.yml 中调高。`read_image` 把 `IMAGE_DIMENSION_TOO_LARGE` 与 `IMAGE_TOO_MANY_PIXELS` 映射为面向模型的错误，指明解析后的路径与上限并提示缩图重试，本轮以可恢复的工具错误继续。Web 输入框对 `IMAGE_DIMENSION_TOO_LARGE` 给出指明上限的专用文案。`read-image-dimension` 快照场景通过组装后的应用无 key 回放这次拒绝：2001x1 的工作区 fixture、一条可恢复的工具错误、一个正常完成的轮次。

## Alternatives considered

- **准入时缩图而非拒绝。** 重采样会让存储字节偏离调用方提供的内容，引入重采样质量策略，还会对模型隐藏上限。拒绝让准入保持为纯粹的门禁；模型或用户可以在知情的前提下自行缩图。只有当拒绝在实践中频繁出现时才值得重新考虑。
- **在 provider 适配器按路由强制执行。** 为时已晚：组装请求时图片已是持久历史，每条路由、每次重试都会再次失败。准入是把必然被上游拒绝的图片挡在外面的最后一道关口。
- **修复已被毒化的会话**（在之后的请求中丢弃或替换超限图片块）。不在本次修复范围内；准入阻止新的毒化，而重写历史需要针对「模型可见 ⟺ 已记录」不变量单独设计。

## Related

- [最小 read_image 工具](../feature/2026-08-10-minimal-read-image-tool.md)，本次修复补上的正是该工具的准入缺口。
- [Web 图片摄入与限制对齐](../feature/2026-08-12-web-image-intake-and-limits-alignment.md)，同一组 `ImageAttachmentLimits` 在输入框侧的呈现。

## Consequences

- 一次超限的 `read_image` 不再能弄坏会话；模型看到可操作的错误，轮次正常完成。
- 单边超过 2000px 的图片即使在其路由本可接受（小请求）的组合中也会被拒绝；这类部署必须显式调高 `maxImageDimension`。
- 已经携带超限图片的会话仍然是坏的；本次改动不修复既有历史。
