---
description: "为 Web GUI 宿主客户端提供 Cordis Loader 与 Agent 预设清单，以及受保护的 Profile 诊断与恢复 Remote。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-plugin-inventory

[English](README.md) | 中文

## 概述

客户端可以检查当前 Loader 条目与 Agent 预设组合，而不改变配置。结果展示请求当下的启用状态、来源与运行健康状态。受控操作提供固定的 Profile 诊断、隔离、恢复、卸载和导出动作，且不接受任意命令或路径。安装期间，客户端可凭 Host 签发的安装 id 读取有容量上限的进度与经过清理的增量输出；私有 pnpm 路径不会越过边界。客户端可暂停或取消这个准确的 id：Host 会终止其受管进程范围，并在确认完全退出后才发布终态。进度观察不会改变重试、超时、诊断或恢复结果。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当客户端或设置页需要展示宿主当前组合了什么——哪些插件已加载、已启用、是否存活，以及每个 Agent 预设会给会话什么——时调用 `pluginInventory/list`。Remote 是唯一入口：该服务仅供 Remote 使用，刻意不声明同进程 Cordis `Context` merge。

对于通过固定请求方法启动的安装，可轮询 `getInstall()` 读取阶段与可选的 `installProgress`。使用 `getInstallOutput({ installId, offset })` 只读取上次返回的不透明游标之后新增的字节。`pauseInstall(id)` 与 `cancelInstall(id)` 只接受 Host 签发的 id，并在受管进程范围退出后才完成。暂停采用跨平台的“停止后续传”语义：之后对同一请求启动新的受控事务，并复用 pnpm 缓存，而不是挂起操作系统进程。较早输出超过容量上限后可能被淘汰，此时 `lossy` 为 true。未知或伪造的安装 id 会直接失败，不能借此选择文件或进程。

### 快照包含什么

每一行是一个非组 Loader 条目：其条目 id、精确模块标识、有效启用状态（含被禁用的祖先组）与当前根 Fiber 阶段。`pending` 表示条目等待加载，`loading` 表示正在读取，`active` 表示正在运行，`failed` 表示其 fiber 被拒绝，`unloading` 表示正在拆除；`null` 表示完全不存在存活的根 Fiber。结构性的 group 行会被跳过。

### 每个预设的组合

组合了 roster 时，`agentPresets` 按 roster 顺序携带每个预设一组：其 id、随部署内置还是用户自建（`trust`，客户端据此本地化内置预设名）、发布的显示名、未指名预设的会话是否组合它，以及压平后的插件行——条目 id（文件行未声明时为 null）、模块标识、有效启用状态、行自带的 `!!js` disabled 表达式（如有），以及组合存活时的根 Fiber 阶段。已有会话组合过的预设由其最新 standing 世代作答——即使其文件事后损坏也是如此，因为挂载才是这些会话实际运行的组合；开机以来从未被组合的预设由其组合文件作答，disabled 门用 Loader 上下文求值，且读取从不挂载预设。`conditional` 表示宿主无法求值的门；无人组合的坏预设保留在列表中，携带原因且没有行。没有 roster 时该字段缺席。

### 你能用它做什么、不能做什么

Loader 清单是供展示与诊断的快照：客户端可以渲染名单、标出失败条目，并通过比较快照检测变化。它不能直接启用或停用任意 Loader 条目，也不携带 Loader 历史——已经失败并被移除的 fiber 缺席。Host 在投影隔离操作前，只有在当前 Loader 把软件包根标记为活动状态，并且 Profile 依赖、有序 Bundle 和已安装软件包清单同时证明插件已经恢复时，才删除过期隔离记录；活动插件保持安装，之后的真实卸载仍走受控包管理操作。独立的受控方法会通过产品 CLI 执行固定 Profile 操作。隔离卸载残留修复只接受当前 Profile 与服务端持有的诊断身份，然后清理已经停用且不存在插件的陈旧元数据；它不能选择其他软件包或重新安装代码。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计理念

网关是一层没有第二个生命周期真源的直接投影：每次 `list()` 调用都读取 `ctx.loader.entries()`，并把每个非组条目映射为公共行。Cordis 内部的 plugin/status 事件已经维护了 `Entry.fiber` 与 `Fiber.state`，因此再加缓存只会多出一个需要同步的生命周期真源。Agent 预设 roster 是每次调用经 `ctx.get('agentPresets')` 解析的可选伙伴：所有预设读取都由它的 `compositionInventory()` 负责，本包只把根 Fiber 状态映射到公共阶段词汇。

### 阶段映射

Fiber 状态映射到公共阶段词汇，其中 `disposed` 折叠为 `null`——fiber 已消失的条目没有可报告的存活根。因此阶段从不区分为什么没有存活根：条目可能从未启动，也可能其 fiber 已被释放。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `PluginInventoryGateway`：`pluginInventory` Remote 服务与 Loader 投影 |
| [`src/install-progress.ts`](src/install-progress.ts) | 增量解析 pnpm NDJSON、计算进度、清理敏感信息并限制终端输出容量 |
| [`src/types.ts`](src/types.ts) | 公共 payload 类型：`PluginInventoryEntry`、`PluginInventorySnapshot`、`PluginFiberPhase` |
| — | 不发布运行时不变式伴生入口；每个快照都投影 Loader 持有的状态。 |

Typert 生成由 `./typert` 与 `./remote` 导出的 Host 和 Client Remote 产物。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当清单约定不够用时阅读以下内容：先看 Remote 如何到达客户端，再看它所投影的 Loader 与渲染它的界面。

- [Remote 组合](../../api/remotes/README.zh.md)——客户端如何在不导入 Host 实现的情况下消费 `pluginInventory/list`。
- [Cordis 插件 loader](../../../vendor/loader/README.md)——本包所投影条目的那个 Loader。
- [插件清单设置界面](../../client/ui-settings-plugin-inventory/README.zh.md)——渲染该清单的浏览器侧投影。

-----

<a id="model-experience"></a>
## 模型体验

无。这个仅限 Host 的只读 Loader 投影不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明一个点时刻清单无法告诉客户端什么。它们是当前包约束，不是任务积压。

- **仅表示调用当下**——结果不包含持久的失败历史或订阅；只要不存在存活的根 Fiber，就会报告 `null`，而不区分其原因。
- **无清单来源与任意修改能力**——名单不识别条目由哪个 bundle、profile 或 override 引入，也不能修改任一平面的启停状态。受控 Profile 操作只接受封闭请求类型，不提供通用 Loader 编辑或命令执行。
- **预设仅随 roster 出现**——未装 `dsh-agent-presets` 的部署只提供 Loader 条目；`agentPresets` 字段缺席而非为空。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
