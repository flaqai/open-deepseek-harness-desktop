---
kind: upgrade-guide
description: "交付的组合不再固定搜索提供方，因此使用 DeepSeek 模型的会话中，网页搜索改用旧版 Messages 搜索而不是 DeepSeek Search API。"
---

# DeepSeek 模型上的搜索默认使用旧版 Messages 搜索

[English](guide.md) | 中文

## 变更

过去，base 把 `web.searchProvider` 固定为 `deepseek-search-api`。现在不设置该选择，由 `dsh-web` 按模型路由选择。`deepseek-official` 和 `deepseek-account` 模型路由优先选择 `deepseek-official` 搜索：它发送一次按模型 token 计费、不按次收费的辅助 Messages 请求，并向会话日志追加 `web/deepseek-search-llm-request`。其他路由和不服务于模型请求的搜索，在 `deepseek-search-api` 可用时优先选择它；否则「自动选择」要求恰好存在一个可用的替代提供方。

Messages 搜索的端点不跟随模型提供方的基础地址：它是 `web-search-deepseek.baseURL`，其次是 `$DEEPSEEK_SEARCH_BASE_URL`，再次是 `https://api.deepseek.com/anthropic/v1`；在账号会话之外，它收到的是 `web-search-deepseek.apiKeyEnv`（默认 `DEEPSEEK_API_KEY`）下的密钥。因此，DeepSeek 模型提供方指向网关的部署会把该密钥发往官方端点，搜索会失败，直到执行第 2 步或第 3 步。

「网页搜索提供方」菜单新增**自动选择**，没有已存选择时即选中它。自行设置了 `web.searchProvider` 的组合或 profile，以及 `DSH_WEB_SEARCH_PROVIDER`，不受影响。Fetch 仍默认为 `http`。

社区桌面端的 `web-deepseek-api.enabled` 默认关闭。独立计费的 Search 与 Fetch API 请求须在设置页或 YAML 中由用户显式启用；该开关不改写自定义提供方或已保存的 Search／Fetch 选择。以前固定的 API 选择仍会保留，在开关关闭时报告不可用。启用后，Search API 可能发送最近一条用户提示，折叠空白后最多取 128 个 Unicode 字符；可在 `web-deepseek-api` 中设置 `sendOriginalQuestion: false` 关闭原文发送。Search 与 Fetch API 的费用独立于模型 Token 费用。

## 迁移

1. 接受新的默认值时无需修改。确认：「网页搜索提供方」菜单显示「自动选择」，且使用 DeepSeek 模型的会话中的搜索会追加一个 `web/deepseek-search-llm-request` 事件。
2. 要让所有模型使用 DeepSeek Search API，须先显式启用独立 API（`web-deepseek-api.enabled: true`），阅读传输及计费说明，再在该菜单中选择 DeepSeek Search API 并保存，或在 `@deepseek-ai/dsh-web` 条目的 `config` 中把 `searchProvider: deepseek-search-api` 与 `fetchProvider: http` 一起设置。确认：菜单显示 DeepSeek Search API，且搜索不再追加 `web/deepseek-search-llm-request` 事件。
3. 要通过网关使用 Messages 搜索，在该菜单中选择 DeepSeek 服务端搜索，把网关的 Anthropic 兼容基础地址（到 `/messages` 之前为止）作为其 Base URL 保存，或设置 `web-search-deepseek.baseURL`；如果其他模型应在 Search API 已显式启用且可用时优先使用它，再重新选择「自动选择」。确认：DeepSeek 模型上的搜索返回结果，且其 `web/deepseek-search-llm-request` 事件指向网关端点。
4. 如果升级前固定的 API 选择报告不可用，可显式启用独立 API，或自行选择其他提供方。升级和启用开关都不会替换自定义提供方，也不会静默重定向固定选择。
