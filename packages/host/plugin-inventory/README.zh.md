# @deepseek-ai/dsh-host-plugin-inventory

[English](README.md) | 中文

当前 Cordis Loader 树的 Host 投影，并提供受控的 profile 插件管理与共享依赖健康状态。`PluginInventoryGateway` 注册 `pluginInventory` 服务，并发布用于清单、安装／卸载任务、当前依赖 doctor 检查与修复、隔离重试与残留卸载、保留修复通知关闭的直接 Remote。隔离卸载会拒绝仍存在于 profile 依赖或 bundle 顺序中的插件，删除停用插件的顶层软件包目录，并且只在删除完成后清除持久记录。每次 list 调用都直接读取 `ctx.loader.entries()`，跳过结构性的 group 行，再按 Loader 顺序返回其余条目的 Loader 条目 id、模块标识、有效启用状态与当前根 Fiber 阶段。同一快照还会投影所配置 profile 的最新实质性修复报告和持久隔离记录，但不暴露文件系统路径。

`externalTools` 投影 Host 连接设置，`setExternalTool` 通过 `AgentPresets` 改变一个受支持的产品。Host 只接受闭集中的 `codex` 与 `claude-code` id，并注册产品专用 projector，把固定的 `dsh-tool-subagent` 绑定挂载到合格 Agent scope。每个绑定还会提供产品专用使用提示，因此用户明确要求使用 Codex 或 Claude Code 时，模型会选择委派工具，而不是寻找同名 shell 可执行文件。roster 负责持久化、完整模式资格、安全的 idle／回合边界时序，以及每个 step 的持久能力记录，而不会把这些控制交给浏览器。

`startInstall` 接收结构化 profile 名称与 npm registry 软件包说明符。它拒绝路径、URL、flag 与 shell 文本，依赖受管 subprocess 能力，并在没有 shell 插值的情况下启动当前产品启动器的 `dsh plugin --profile <name> add <package>` 模式。`startUninstall` 对精确 registry 包名采用相同边界。`startDependencyDoctor` 执行核心只读 `doctor` 命令或明确的 `--repair` 模式；`getDependencyDoctor` 返回结构化的 `healthy`、`issues`、`repaired`、`quarantined` 或 `failed` 状态，并投影不含本地路径的冲突与失管 bundle。隔离重试会为选中的持久 id 调用 `doctor --retry`，保留记录中的依赖说明符与 bundle 位置，而不是合成一次 registry 安装。调用立即返回任务 id；同一目标最多只有一个运行中任务。成功的改动只影响 profile 的下次启动组合，绝不会修改已经启动的 Loader 树。

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
- **Web profile 投影** —— 随附的 Settings 组合投影 `web` profile；Host 配置可以选择其他 profile，但单个 gateway 不会聚合多个 profile 的健康状态。
