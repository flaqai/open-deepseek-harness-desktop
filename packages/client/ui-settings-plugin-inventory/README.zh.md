# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

[English](README.md) | 中文

当清单包含 `dshmarket` 时，展开卡片会显示由核心 Host Remote 支持的风险确认卸载操作。打包应用会尊重成功移除，不会重新预装市场。

Web 插件清单、诊断、外部工具连接与发现界面。浏览器插件注册 id 为 `all` 的本地化 `settings.plugins.tab` 贡献，以及 id 分别为 `external-tools` 与 `diagnostics` 的根 `settings.section` 贡献；“插件”分区继续只拥有清单标签栏。它还会向新会话主页贡献根作用域 `conversation.hero.pluginDiscovery` 入口。该入口打开一个社区项目精选指引，所列项目都明确记录了官方 `dsh plugin --profile ... add ...` 流程。每张卡片会标明第三方来源与许可证、显示带日期的 Star 档位、链接到源码仓库、复制项目记录的命令，并通过结构化 Host Remote 提供受保护安装。安装需要明确确认风险，展示后台进度与有界诊断，并说明重启后新 bundle 才会生效。界面不会转发任意 shell 文本，也不会在运行时请求 GitHub。底部链接进入完整 GitHub `dsh-plugin` 专题以继续发现；进入专题和 Star 数量都不代表安全审核或 DeepSeek 官方背书。

“外部工具”分区为 Codex 与 Claude Code 提供一处易发现的连接流程：安装精确版本的官方 Provider bundle，重启使其挂载，再为完整模式连接或断开该产品。Host 独立于 Agent Preset 保存连接状态，并在 Agent 发布、idle 或从 idle 同步进入 running 的边界把启用工具投影到 Agent 自己的 scope。因此已有历史会话会从下一轮获得新连接；运行中的回合保持当前工具直到回到 idle，`minimal` 继续保持精简。当前 Harness 版本没有 Hermes 与 Trae 的官方 Provider bundle，因此两者仍显示为不可操作的占位项。

插件清单标签页在插件激活期间不会读取 Remote；首次选择该标签页时才挂载组件，并通过 [`api-remotes`](../../api/remotes/README.md) 懒调用 `ctx.remote.pluginInventory.list()`。

独立的“诊断”分区会运行核心 profile doctor，而不是从市场插件输出推断依赖健康状态。“立即检查”始终只读；“检查并修复”调用受保护的收敛与隔离策略。页面汇总当前冲突、失管 Loader 条目、运行中根 Fiber 挂载失败和持久隔离记录，再展示不含文件系统路径的依赖链与兼容性。冲突所指向的活动根插件在用户明确确认风险后，会通过与清单界面相同的结构化 `startUninstall` 任务移除；界面轮询进度，并在任务结束后刷新下次启动清单。失管 Loader 条目已经不属于 profile 依赖，因此不会伪装成包管理器可卸载项。启动时保留的修复通知仍可关闭，但不会删除隔离历史。每个隔离插件都支持按记录中的说明符重试，或在风险确认后物理移除处于停用状态的残留软件包与持久记录。该实现完全属于本包，不修改也不依赖 `dshmarket` 自带的诊断标签。

每张收起的清单卡片使用模块短名称作为标题，以小标签表示有效启停状态；已启用的条目还会以彩色圆点表示根 fiber 状态。展开卡片后会直接展示 Loader 树条目 id，不附加重复的字段标题，并列出有效配置状态；已启用的条目还会列出 Cordis 状态，已停用的条目则省略重复的“未挂载”运行状态。条目 id 仍作为 React key、展开标识、详情值与额外的搜索目标；代码不按字符串形状对它分类。加载、空结果、无匹配结果与通用失败状态只属于已挂载组件；读取失败后可以重试，且不会暴露传输细节。注册使用 `ctx.slots.inject()`，因此能跟随标签 slot 的延迟声明、重新声明、本地化变化与 teardown，而无需 import 分区拥有方。

## 模型体验

无，因为本包在浏览器界面展示 Host 拥有的部署状态并启动用户确认的 profile 安装，不注册任何模型接口。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **每次 Settings 挂载或重试只读取一份快照** —— 标签页不订阅 Loader 变化，也不会在重连后自动重新读取；切换标签页会保留当前快照，重新打开 Settings 则会取得新快照。
- **只读 Loader 视图** —— 本地搜索不会额外引入来源、按来源分组、当前浏览器激活诊断或实时 Loader 修改控件。
- **带日期的发现元数据** —— 精选卡片是 2026-08-16 采集并检查来源的指引，不是实时榜单。链接的 GitHub 专题用于查看更广、持续变化的目录。
- **仅 registry 安装来源** —— 安装操作接受已审阅的 npm registry 软件包说明符。Git、URL、alias、tarball 与本地路径来源继续通过界面展示的 CLI 流程使用。
- **仅官方 Provider** —— Codex 与 Claude Code 因本版本带有对应 Provider bundle 而可操作；Hermes 与 Trae 在正式 Provider 契约出现前只作信息展示。
