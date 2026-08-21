# @deepseek-ai/dsh-client-ui-brand-community-desktop

[English](README.md) | 中文

本包仅在 `DSH_CLIENT_BUILD_PROFILE` 为 `community-desktop` 时填充侧边栏和会话首页的品牌插槽。它将社区桌面版品牌与上游官方产物 Profile 分离，并且不保留运行时状态。

## 模型体验

无，因为本包只提供浏览器展示内容；这里没有任何内容会进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与后续工作

- 浏览器标题由构建时的 `DSH_CLIENT_TITLE` 独立选择。
