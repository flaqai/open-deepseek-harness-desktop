# @deepseek-ai/dsh-host-plugin-inventory

[English](README.md) | 中文

除受控安装外，`startUninstall` 只接受精确 registry 包名，并通过托管子进程边界运行 `dsh plugin --profile <name> remove <package>`。版本、路径、URL、flag 与 shell 文本都会被拒绝。

当前 Cordis Loader 树的 Host 投影，并提供受控的 profile 插件安装。`PluginInventoryGateway` 注册 `pluginInventory` 服务，并发布三个由 Typert 生成的直接 Remote：`pluginInventory/list`、`startInstall` 与 `getInstall`。每次 list 调用都直接读取 `ctx.loader.entries()`，跳过结构性的 group 行，再按 Loader 顺序返回其余条目，并且只包含 Loader 条目 id、模块标识、有效启用状态与当前根 Fiber 阶段。

`startInstall` 接收结构化 profile 名称与 npm registry 软件包说明符。它拒绝路径、URL、flag 与 shell 文本，依赖受管 subprocess 能力，并在没有 shell 插值的情况下启动当前产品启动器的 `dsh plugin --profile <name> add <package>` 模式。调用立即返回任务 id；`getInstall` 用于轮询运行中、成功或失败状态及有界包管理器诊断。同一目标最多只有一个运行中任务。安装成功会经同一条 CLI 路径更新 profile 依赖与 bundle 层，但不会修改已经启动的 Loader 树；重启后新组合才会生效。

阶段为 `pending`、`loading`、`active`、`failed` 或 `unloading`；条目没有存活的根 Fiber 时则为 `null`。该快照刻意只表示调用当下：Loader 仍是唯一的生命周期权威，本包不拥有清单缓存、历史、来源模型或事件流。安装只修改所选 profile 的下次启动组合。公开 payload 类型位于 `./types`，Typert 生成由 `./typert` 与 `./remote` 导出的 Host 和 Client Remote 产物。

该服务仅供 Remote 使用，刻意不声明同进程 Cordis `Context` merge。Client 包通过显式的 [`api-remotes`](../../api/remotes/README.md) 组合消费它，而不导入 Host 实现。安装器输出保留上限与进程终止宽限均为可由部署配置的字段。

## 模型体验

无，因为这个 Host 清单与安装服务不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **仅表示调用当下** —— 结果不包含持久的失败历史或订阅；只要不存在存活的根 Fiber，就会报告 `null`，而不区分其原因。
- **不修改实时树** —— 服务不识别条目由哪个 bundle 或 override 引入，也不能启用、停用或移除 Loader 行。安装只修改 profile 的下一次启动组合。
- **仅 registry 软件包** —— Git、URL、tarball、alias 与本地路径说明符继续只供 CLI 使用，直到 Host 请求能够逐类表达并审阅这些来源而不退化为任意命令执行。
