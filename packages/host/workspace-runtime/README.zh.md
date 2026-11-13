---
description: "为已校验的可选 Python 载荷、随应用提供的 Node 工具和 Office 技能提供 Profile 适配。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-workspace-runtime

[English](README.md) | 中文

## 概述

此适配模块通过 `load_workspace_dependencies` 暴露由应用管理的 Python 载荷。受信任的桌面主进程提供绝对路径；插件在注册工具前校验载荷元数据和路径。配置 `office: true` 时，它还会以 `pythonEnvironment: workspace-dependencies` 注册随应用提供的 DOCX、PPTX 和 XLSX 技能，让创作使用此适配器返回的托管或用户选定的 Python。它本身不下载、解压、启用或删除载荷。

**运行时不变量：**不发布配套组件。Desktop 运行时管理器先校验载荷，此适配器再通过 Profile 挂载载荷。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

只应通过桌面应用拥有的 Profile 配置块挂载。`runtimeRoot` 必须包含 `runtime.json` 和当前平台的 Python 目录；`node`、`pnpm` 与 `nodePackages` 指向普通 Harness 运行时，因此可选归档不会重复携带 Node。路径缺失、目标平台不兼容、清单无效或规范化后重复的 Python 分发包名称都会令插件激活失败。

-----

<a id="model-experience"></a>
## 模型体验

### 工作依赖发现

#### 模型看到什么

`load_workspace_dependencies` 工具返回明确的 Python、Node、pnpm、Python site-packages、Node packages 路径和锁定的分发包版本。只有 Office 能力配置块启用时，Office 技能才会出现。

#### Token 影响

适配模块挂载期间会提供稳定的工具声明。每次调用只追加返回的路径和版本清单，不会主动注入运行时元数据。

#### KV Cache 影响

固定 Profile 下工具声明保持稳定。工具结果追加到对话中，而启用或停用 Office 配置块会在重启后改变可用技能目录。

## 已知限制与延期事项

<a id="known-limitations-and-deferred-work"></a>

- 插件信任桌面管理器已经完成摘要和归档校验；它会再次校验载荷身份和路径是否存在，但不会重复验证归档签名。

<a id="dev-note"></a>
### 开发备注

无。
