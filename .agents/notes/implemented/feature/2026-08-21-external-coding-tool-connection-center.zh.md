# Agent Note: 外部编码工具连接中心

Status: implemented

[English](2026-08-21-external-coding-tool-connection-center.md) | 中文

## 问题

把编码产品作为 Harness 子 agent 使用需要同时满足两个事实：其 Provider bundle 必须属于活动 Web profile，并且所选 agent preset 必须启用对应 Provider 的工具行。插件清单会展示前一个事实，但 agent preset 选择器只会在用户已经知道该检查哪个 preset 后展示后一个事实。因此，即便 Codex Provider 安装成功，实际入口仍很难发现；而把每个产品名称都做成可安装项，又会错误暗示运行时具备并不存在的 Provider 支持。

## 决策

Settings 在现有产品分区旁提供一个根 `external-tools` 分区。它为每个编码产品展示单一连接流程，并并行读取 Host 所有的两份状态：实时插件清单与 Host 连接设置。Codex 与 Claude Code 可操作，因为本版本存在对应的官方 Provider bundle。安装使用与应用基线匹配的精确包版本；安装完成后要求完整重启，因为运行中的 Loader 树不可修改。Hermes 与 Trae 在正式 Provider bundle 和工具行出现前保持为不可操作的占位项。

连接受支持的产品会独立于 Session preset 身份保存一项 Host 设置。`AgentPresets` 负责安全边界投影：Host 注册唯一的产品专用 projector，每个启用的 `dsh-tool-subagent` 实例挂载到合格 Agent 自己的 scope。`standard`、`code` 与 `cordis` 参与投影，`minimal` 保持不变。空闲 Agent 立即更新；已经运行的 Agent 保留精确的当前工具 fiber，直到回到 idle。从 idle 同步进入 running 的状态变化会在提示词组装前再次对齐，因此恢复的历史 Session 会从下一轮获得当前连接，而运行中的请求不会被修改。

每个模型请求 step 使用的精确动态投影都会记录为一次 `external-tools/resolved`。某个 Session 曾使用连接工具后，后续断开的 step 会记录空列表。同一个 step 的重试不会重复记录，因此模型可见工具可以从 Session 重建，而不是从可变的当前设置推断。

浏览器永远不会收到文件系统路径或组装文档。有类型的 `pluginInventory` Remote 只接受闭集中的 `codex` 与 `claude-code` id，并把 preset 所有权委托给 `AgentPresets`。这样，软件包安装、roster 创作与 UI 展示仍由各自既有所有者负责，同时产品获得一个统一且容易发现的入口。

## 考虑过的替代方案

**把连接按钮放进 Agent presets。** 否决，因为 Provider 安装与 Loader 激活属于 profile 部署状态，而不是 preset 创作状态。一个停用的工具行无法在不把插件管理能力引入 roster UI 的前提下，说明 Provider 是缺失、仍在安装，还是正等待重启。

**复制或修改 `standard`。** 否决，因为两种做法都会继续把连接状态耦合到 Session preset 选择。受管副本还会与后续随附 preset 改进产生偏离，而且已有历史 Session 仍无法使用刚连接的产品。

**重组运行中 Session 的整个 preset。** 否决，因为这会同时改变提示词 section、Skill、监听器、隔离服务和工具。需求只是在下一次安全请求边界增加产品工具；替换完整组装会让既有能力失去对应项，并可能中断活动工作。

**为 Hermes 与 Trae 提供通用软件包输入框。** 否决，因为产品名称不能证明存在兼容的 `SubagentProvider`、工具行、软件包来源或协议契约。不可操作的占位项可以表达预期导航，却不会把任意软件包安装伪装成连接承诺。

**安装 npm 未带版本的 latest tag。** 否决，因为 dist-tag 可能滞后，也可能独立于桌面基线移动。Provider 协议兼容性属于打包应用的一部分，因此此入口固定匹配的发行版本。

## 后果

用户无需预先知道软件包名或 preset 工具行就能发现 Codex 与 Claude Code；连接现在表示已有或新建完整模式 Session 从下一轮开始可用。闭集 Remote 与唯一 projector 防止便利界面退化成任意 preset 编辑器或 shell 启动器。通用 roster 不依赖具体产品工具包；桌面 Host 拥有固定的 Provider/工具绑定。新增另一个可操作产品需要正式 Provider bundle、闭集 Host id、明确的适用模式决策、本地化产品文案，以及覆盖边界投影、持久请求记录、Remote 注册与 Settings 交互的聚焦测试。

## 验证

preset 测试固定适用模式、独立设置、已有会话投影、断开移除、minimal 排除、重复 projector 拒绝，以及每个 step 唯一的持久能力记录。Host 测试固定有类型的 Remote 清单，客户端测试固定本地化分区注册、受支持操作、诚实占位项与 Codex 连接状态变化。类型检查覆盖 projector 依赖图、生成的 Remote 图与桌面客户端组装。
