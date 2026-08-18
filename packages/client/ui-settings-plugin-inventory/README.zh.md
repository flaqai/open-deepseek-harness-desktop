# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

[English](README.md) | 中文

当清单包含 `dshmarket` 时，展开卡片会显示由核心 Host Remote 支持的风险确认卸载操作。打包应用会尊重成功移除，不会重新预装市场。

Web 插件清单与发现界面。浏览器插件注册一个 id 为 `all` 的本地化 `settings.plugins.tab` 贡献；“插件”分区拥有导航入口与标签栏。它还会向新会话主页贡献根作用域 `conversation.hero.pluginDiscovery` 入口。该入口打开一个社区项目精选指引，所列项目都明确记录了官方 `dsh plugin --profile ... add ...` 流程。每张卡片会标明第三方来源与许可证、显示带日期的 Star 档位、链接到源码仓库、复制项目记录的命令，并通过结构化 Host Remote 提供受保护安装。安装需要明确确认风险，展示后台进度与有界诊断，并说明重启后新 bundle 才会生效。界面不会转发任意 shell 文本，也不会在运行时请求 GitHub。底部链接进入完整 GitHub `dsh-plugin` 专题以继续发现；进入专题和 Star 数量都不代表安全审核或 DeepSeek 官方背书。

插件清单标签页在插件激活期间不会读取 Remote；首次选择该标签页时才挂载组件，并通过 [`api-remotes`](../../api/remotes/README.md) 懒调用 `ctx.remote.pluginInventory.list()`。

该标签页以可搜索的双列紧凑折叠卡片展示清单。每张收起的卡片使用模块短名称作为标题，以小标签表示有效启停状态；已启用的条目还会以彩色圆点表示根 fiber 状态。展开卡片后会直接展示 Loader 树条目 id，不附加重复的字段标题，并列出有效配置状态；已启用的条目还会列出 Cordis 状态，已停用的条目则省略重复的“未挂载”运行状态。条目 id 仍作为 React key、展开标识、详情值与额外的搜索目标；代码不按字符串形状对它分类。加载、空结果、无匹配结果与通用失败状态只属于已挂载组件；读取失败后可以重试，且不会暴露传输细节。注册使用 `ctx.slots.inject()`，因此能跟随标签 slot 的延迟声明、重新声明、本地化变化与 teardown，而无需 import 分区拥有方。

## 模型体验

无，因为本包在浏览器界面展示 Host 拥有的部署状态并启动用户确认的 profile 安装，不注册任何模型接口。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **每次 Settings 挂载或重试只读取一份快照** —— 标签页不订阅 Loader 变化，也不会在重连后自动重新读取；切换标签页会保留当前快照，重新打开 Settings 则会取得新快照。
- **只读 Loader 视图** —— 本地搜索不会额外引入来源、按来源分组、当前浏览器激活诊断或实时 Loader 修改控件。
- **带日期的发现元数据** —— 精选卡片是 2026-08-16 采集并检查来源的指引，不是实时榜单。链接的 GitHub 专题用于查看更广、持续变化的目录。
- **仅 registry 安装来源** —— 安装操作接受已审阅的 npm registry 软件包说明符。Git、URL、alias、tarball 与本地路径来源继续通过界面展示的 CLI 流程使用。
