---
description: "带版本的全局与 Workspace 自定义提示词、可信编辑入口和运行时上下文注入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-custom-instructions

[English](README.md) | 中文

## 概述

`dsh-custom-instructions` 允许用户为所有对话或单个已注册 Workspace 保存附加说明。每次匹配的模型请求都会依次加入当前全局版本和当前 Workspace 版本。空文本会停用对应范围。修改从下一次请求开始生效，不会重写先前的 Session 历史。

只有第一方设置页与 Workspace 控件可以编辑该命名空间；Agent 和插件不会获得提示词管理 API。

**运行时不变量：**不发布配套组件。Settings 命名空间保存各版本，请求上下文适配器只读取当前启用的版本。

## 目录

- [使用本包](#use-this-package)
- [持久化与诊断](#persistence-and-diagnostics)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

Web bundle 在 Workspace 支持之后挂载本包。打开**设置 → 自定义提示词**可编辑任一范围，也可从 Workspace 的更多操作菜单直接打开该 Workspace。每次保存非空文本都会创建不可变版本；保存空文本会停用该范围，但不会改写既有版本。

编辑器与 Workspace 设置行的输入框、标签、状态提示和键盘焦点使用共享主题颜色，跟随应用的浅色与深色外观。

| 范围 | 适用对象 | 优先顺序 |
|---|---|---|
| 全局 | 所有 Agent，包括没有匹配已注册 Workspace 的会话 | 位于 Workspace 文件说明之后 |
| Workspace | Session 工作目录与已注册 Workspace 路径完全一致的 Agent | 位于全局自定义提示词之后 |

完整顺序为：平台与安全说明、Agent 预设、Workspace 文件说明、全局自定义提示词、Workspace 自定义提示词。自定义提示词仍属于用户指导，不能覆盖平台、安全或开发者指令。

<a id="persistence-and-diagnostics"></a>
## 持久化与诊断

版本和诊断导出偏好保存在 `custom-instructions` 设置命名空间，因此社区桌面版的一般配置复制、备份、恢复和迁移会像处理其他设置一样携带它们。删除 Workspace 成功后才删除其编辑器历史；先前模型请求实际使用的版本仍可从该 Session 的运行时上下文快照还原。

会话诊断导出默认不包含自定义提示词明文。尚未记住选择时，导出弹窗允许用户决定包含或排除明文，并可记住这次确切选择。若选择“包含”并记住，界面会明确警告以后导出将不再询问并自动包含明文。设置页可恢复为每次询问。

<a id="model-experience"></a>
## 模型体验

### 当前自定义提示词上下文

#### 模型看到什么

每次请求最多贡献两个运行时上下文 section，顺序为全局在前、Workspace 在后。

##### 运行时上下文模板

```markdown
<custom-instructions scope="global" version="<revision-id>">
<active global text>
</custom-instructions>

<custom-instructions scope="workspace:<workspace-id>" version="<revision-id>">
<active Workspace text>
</custom-instructions>
```

#### Token 影响

每个已启用范围都会在每次模型请求中加入其渲染文本；空范围不增加 token。每个保存版本分别受 32,000 字符上限约束。

#### KV Cache 影响

版本修改会从下一次请求开始改变运行时上下文后缀。先前 Session 快照保持不变，此上下文之前的可复用前缀仍遵循普通缓存行为。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- Workspace 归因要求 Session 的 `cwd` 与已注册 Workspace 路径完全匹配；没有匹配项的会话只接收全局提示词。
- 本功能约束可信 UI 入口并记录提示词归因，但不会隔离已经能够读取本地 Settings 存储的第三方 Host 插件。
- 既有 Session 快照会按设计保留提示词文本。删除 Workspace 只删除编辑器历史，不删除历史模型可见证据。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
