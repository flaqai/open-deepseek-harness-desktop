---
description: "社区桌面悬浮窗中的精简认证会话与历史视图。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-overlay-chat

[English](README.md) | 中文

## 概述

悬浮窗显示当前会话、正常的消息输入框、近期历史和新建会话入口，不另建 Session 存储。它与主窗口使用同一个已认证的 Harness 来源，包括用于远程聊天的已选 NAS。隐藏球体不会删除会话或停止正在运行的工作。

## 目录

- [使用此包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

社区桌面组合仅为独立的 `?surface=orb` 渲染器加载此插件。该渲染器沿用已认证的客户端连接和现有的 Workspace 导航服务。普通浏览器与主窗口仍使用标准应用布局。

-----

<a id="understand-the-implementation"></a>
## 实现说明

此插件仅在悬浮渲染器中占据根 slot。它通过 keyed `main` slot 渲染现有会话组件及输入框，并把新建会话和历史选择交给 `uiWorkspace`；主窗口继续拥有其常规根 slot。受信任的桌面划词事件把纯文本插入所选会话草稿，不会发送消息。若会话尚未就绪，文字暂存在渲染进程内存中，直到会话可以接收草稿；可见提示也提供手动重试入口。

<a id="model-experience"></a>
## 模型体验

无；本包仅展示现有 Session 事件与用户控件。用户发送消息后，消息通过常规会话提交路径进入模型。

#### KV Cache 影响

无；本包不组装模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 精简视图要求 Harness 来源已连接。NAS 模式允许远程聊天，但不会授予本机截图、输入、划词或后台任务能力。
- 本展示包不提供系统级 Computer Use、划词捕获或后台 agent 控件。它只消费桌面 Host 传入的有长度限制的划词文本。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

悬浮渲染器须使用同一个已认证的 Host 来源；不要增加独立的会话 transcript 存储或无保护的 RPC 代理。

</details>
