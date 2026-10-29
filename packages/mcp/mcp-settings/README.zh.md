---
description: "在内置设置中管理 Profile MCP 服务，包括 stdio 与 HTTP 连接、启停及配置失败后的恢复。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-settings

[English](README.md) | 中文

## 概述

在内置设置页添加、编辑、启用和删除 MCP 服务。静态 Profile 受管服务仍可编辑，动态表达式和来自其他配置层的服务保持只读。本地 stdio 命令会在 Agent 沙箱之外执行受信任的第三方代码。保存配置不代表服务已经连接成功。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 Web 或社区桌面版设置中打开 MCP 服务。本地命令选择 stdio，远程端点选择 Streamable HTTP，保存前核对配置。环境变量和 HTTP 请求头可能含凭据；编辑器仅在用户主动要求时展示。

页面编辑当前 Profile，不建立独立的桌面配置存储。没有热重载时，修改需要重启。已有服务保留命名空间和配置；新增内置页面不会自动安装或启动服务。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Host 校验请求，并在文件锁内编辑当前 Profile 补丁。启用 HMR 时，协调操作在 HMR 独占锁内运行，激活失败会恢复之前的补丁。没有 HMR 时，写入等待重启后生效。浏览器使用生成的 Remote 约定和共享设置控件。

管理逻辑源自采用 MIT 许可证的 dsh-pluginHive MCP 面板。本包在 [NOTICE](NOTICE) 和 [LICENSE](LICENSE) 中保留署名。启动器仅在内置替代模块明确启用时抑制旧面板；旧包和所有 MCP 服务数据均保留。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [MCP 客户端](../mcp-client/README.zh.md)——连接配置与执行限制。
- [Web 样式](../../../docs/web-styling.zh.md)——共享字号与深浅色语义。
- [桌面版](../../../apps/desktop/README.zh.md)——本机和 NAS 运行端归属。

<a id="model-experience"></a>
## 模型体验

通过配置的 MCP 客户端间接影响模型；客户端拥有工具 schema、服务指令及连接资源。

#### KV Cache 影响

设置页不添加提示词；修改服务配置可能改变后续模型请求中的 MCP 工具与指令。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- 有效服务的工具列表也可能为空；页面不会把零工具等同于连接失败。
- 来自 bundle 或覆盖层的服务只读，应编辑其所属配置。
- 动态 JavaScript 配置保持只读，编辑器不会求值或替换表达式。
- 页面不下载 MCP 可执行文件，也不为本地服务命令提供沙箱。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
