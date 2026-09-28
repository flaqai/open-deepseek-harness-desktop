---
description: "需要 Desktop Host 桥接和主机所属调用者授权的实验性 Orb 电脑操作提供者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-computer-use-orb-native

[English](README.md) | 中文

## 概述

本包定义三个作者模式前台工具：`orb_observe`、`orb_click` 和 `orb_type`。本包不实现原生截图或输入。Desktop Host 必须提供 `OrbHostBridge` 并显式挂载 `createOrbComputerUseProvider(bridge)`。直接加载本包会失败，且不会注册工具或电脑操作提供者。

## 目录

- [主机集成](#host-integration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="host-integration"></a>
## 主机集成

`bridge.open(acquireExclusive)` 创建一个 `OrbBackend`。后端在公开操作前恰好调用一次 `acquireExclusive()`，并在 `close()` 时调用返回的释放函数。插件在打开后端前通过官方 `ctx.computerUse.register` 名额占用 `orb-native`；卸载时先移除工具、等待调用、关闭后端，最后释放名额。缺少后端、启动失败或提供者冲突均拒绝激活。

`bridge.authorize(agent, signal)` 接收实际的 Agent，必须检查主机拥有的调用者身份。提示词组装期间会对其他 Agent 隐藏工具 schema，每个工具执行器还会在原生访问前再次拒绝缺失 Agent 或返回 false 的授权结果。渲染器提供的 `sessionId` 不构成权限。Desktop 桥接必须提供原生权限、前台窗口、截图和输入实现；后端必须在发送 HID 输入前拒绝过期帧 ID 和焦点变化。

每次成功操作都通过 `ctx.attachments` 保存返回的截图，并随新 `frame_id` 发出持久图像块。坐标是图像上 0–1000 的整数比例。仅支持点击和文字输入；本包不包含 Shell 命令或自动工具审批。

不发布运行时不变量伴随模块：提供者注册和后端生命周期由同一方拥有，没有能够独立观测并产生分歧的状态。

<a id="dev-note"></a>
## 开发备注

固定的 Orb 参考提交 `72f1d738` 为截图封套和 0–1000 坐标提供了依据。本提供者使用当前独占的 `ctx.computerUse.register` 接口，并将原生权限保留在 Desktop。

<a id="model-experience"></a>
## 模型体验

### Orb 工具与结果

#### 模型看到什么

只有已授权的 Orb Agent 会收到 `orb_observe`、`orb_click` 和 `orb_type` 的 schema。成功结果包含前台应用、可选窗口标题、新的 `frame_id`、0–1000 坐标空间和截图图像块。执行方主机拒绝已授权 Orb 调用者之外的调用。

#### Token 影响

三个工具 schema 增加固定请求开销。每个结果追加简短文本封套和一张图像；模型费用取决于所选路由。

#### KV Cache 影响

提供者挂载期间 schema 保持稳定。每张截图追加一个新的工具结果；更换活动提供者会改变工具集合，可能使可复用的提示词前缀失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **Desktop 桥接** — 在 Desktop 提供原生操作和主机所属调用者检查前，本包刻意保持未绑定状态。直接通过 Loader 加载会安全失败。
- **前台操作集合** — 只公开观察、点击和文字输入。滚动、拖动、快捷键和打开应用需要单独审查的原生方法与工具。
- **初始观察** — 作者必须调用 `orb_observe`；本包不会向 Session 插入首轮截图。
