---
description: "社区桌面悬浮窗中的精简认证会话与历史视图。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-overlay-chat

[English](README.md) | 中文

## 概述

悬浮窗显示当前会话、近期历史和新建会话入口，不另建 Session 存储。它仅在社区桌面版的悬浮渲染器中出现，与主窗口使用同一个已认证的本机 Host。隐藏球体不会删除会话或停止正在运行的工作。

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

此插件仅在悬浮渲染器中占据根 slot。它在所选 Session provider 下渲染现有聊天视图，并把新建会话和历史选择交给 `uiWorkspace`；主窗口继续拥有其常规根 slot。

<a id="model-experience"></a>
## 模型体验

无；本包仅展示现有 Session 事件与用户控件。用户发送消息后，消息通过常规会话提交路径进入模型。

#### KV Cache 影响

无；本包不组装模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 精简视图只在本机桌面 Host 完成认证后可用；NAS 模式不创建悬浮渲染器。
- 本展示包不提供系统级 Computer Use、划词捕获或后台 agent 控件。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

悬浮渲染器须使用同一个已认证的 Host 来源；不要增加独立的会话 transcript 存储或无保护的 RPC 代理。

</details>
