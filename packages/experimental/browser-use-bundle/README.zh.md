---
description: "携带 Playwright 与 DevTools 接入；选择组合包后使用本机浏览器启用 Playwright。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-browser-use-bundle

[English](README.md) | 中文

## 概述

携带 Playwright 与 DevTools 接入；选择组合包后使用本机浏览器启用 Playwright。 它随安装交付，但默认 CLI Profile 不选择此组合包。桌面能力页通过已有候选事务选择单个后端。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

将此可选组合包加入自定义 Profile 即可启用。桌面通过“工具与能力”配置后端，请勿同时叠加这两种配置。仅预装不会启动 MCP 进程，也不会启用原生 Computer Use。

<a id="understand-the-implementation"></a>
## 理解实现

[`cordis.patch.yml`](cordis.patch.yml) 选择后端，声明依赖携带离线闭包。桌面启动候选可在找到本机 Chrome 或 Chromium 时一次性选择 Playwright；已有选择保持不变。

<a id="further-exploration"></a>
## 进一步探索

- [后端](../browser-use-playwright-mcp/README.zh.md)
- [后端](../browser-use-chrome-devtools-mcp/README.zh.md)

<a id="model-experience"></a>
## 模型体验

### 所选后端的贡献

#### What the model sees

选择组合包后提供 [Playwright 后端](../browser-use-playwright-mcp/README.zh.md#model-experience) 的 `mcp__playwright-mcp__<tool>` 浏览器工具及获准的截图。DevTools 随安装交付，但此补丁不挂载它。默认 CLI 模板不挂载这两个后端。

#### Token effect

所选后端拥有工具定义、引导和返回结果。仅在该后端挂载或其调用产生结果时加入相应 token。

#### KV Cache effect

选择或移除后端会改变工具与引导前缀。保持同一后端可维持前缀稳定；工具结果追加到历史中。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 浏览器模式需要本机 Chrome 或 Chromium。原生 Computer Use 需要支持的平台资源及系统权限。
- 最终离线安装包仍须完成对应平台的打包验收，单元测试不能替代。

<a id="dev-note"></a>
### 开发备注

此层保留可选组合包的安装边界，不将实验后端提升为默认产品服务。
