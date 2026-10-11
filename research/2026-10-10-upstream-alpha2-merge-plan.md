# 官方 0.2.1-alpha.2 合并评估与计划

## 调研范围与结论

本笔记记录 2026-10-10 的发布与源码比较，以及尚未实施的合并计划。推荐在独立工作树合入固定的 `dsh-v0.2.1-alpha.2` 标签，不跟随持续变化的上游 master，不在本次调研中修改产品版本、提交、推送或发布。

[官方最新 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.2)发布于北京时间 2026-10-09 19:09:26，标记为预发布；[实时 Release API](https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/tags/dsh-v0.2.1-alpha.2)的上传资源数组为空，这不代表官方下载站没有安装包，不能据此推断下载站状态。

## 本地证据

- master 已包含 `dsh-v0.2.1-alpha.1`，两者共同祖先就是该上游标签对应的提交。
- 上游 alpha.1 到 alpha.2 有 669 个提交，包含合并提交；本地关闭 rename 检测的路径比较计为 3,357 个变更路径，不等于需要人工处理的冲突数。[上游比较](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.1-alpha.1...dsh-v0.2.1-alpha.2)的 API 文件列表有截断限制，不用它计全部文件。
- `git merge-tree --write-tree --name-only master dsh-v0.2.1-alpha.2` 的只读模拟列出 111 个冲突路径，其中 28 个修改/删除冲突。命令返回非零表示有冲突，没有修改工作区或索引，也没有开始实际 merge。
- 31 个冲突路径在 `apps/desktop`，29 个在 `packages/client`。其余包括 web-app 启动、HMR、SDK、子代理、系统提示词、锁文件和生成文档。
- 当前工作分支为 `fix/macos-official-window-frame`，存在桌面菜单、窗口边框、CLI 菜单和对应测试的未提交修改。
- `git cherry master HEAD` 将 `release(desktop): prepare 0.2.1-alpha.1 compatibility pins` 和 `fix(desktop): print managed CLI smoke marker on its own line` 标为尚无等价补丁；README 提交已在 master 有等价补丁。实施前必须核对前两项是否仍需保留，不能仅按提交是否相同重复合入 README。

## 上游增量与风险

以下变更依据[发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.2)，风险级别是结合社区实现作出的判断，尚非运行验收结果。

| 范围 | 上游变化 | 社区适配重点 | 风险 |
|---|---|---|---|
| Python PTC | 接入 Session 文件沙箱，自定义组合需提供 sandbox 与 sandboxPolicy | 自定义解释器、托管 Python、工作目录、取消、审批及拒绝执行语义 | 高 |
| 子代理与 SDK | 工具立即返回 child ID，runtime 需要 session/wait | 调用方、完成通知、取消、持续子代理及 TS/Python SDK 输出 | 高 |
| Agent Team | 消息直接投递 Inbox，移除 outbox、重试及重发去重 | 配置与返回字段迁移，社区首次启用引导和“去使用”入口 | 高 |
| 工具展示与指令 | 删除 both；删除 agent-instructions 逐行 dshHome；新增共享 AGENTS 目录 | Profile、旧配置、NAS 远端路径、自定义提示词顺序和审批语言 | 高 |
| 桌面资源 | Electron、native loader、打包依赖及 Windows PTY 清理更新 | 不能整体替换社区壳；核验原生 ABI、资源闭包与安装器 | 高 |
| Web 与 NAS | 指定 IPv4/IPv6、原生 TLS、远程目录选择器 | 原有连接认证、证书检查、远端选目录及本机/远端操作区分 | 高 |
| 会话和界面 | 插件 Session 状态记录、工作目录切换、字体、子代理图片输入、预览性能 | 旧历史迁移白名单、动态目录、手机布局和社区归档外观 | 中高 |
| 新实验插件 | 思考翻译、Git Worktrees、按需安装 Claude Code/Codex 组合包 | 保留上游显式启用；翻译隐私与付费提示、安装版本匹配 | 中 |

Python PTC 的[目标实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/experimental/ptc-runtime-python/src/index.ts)声明 `static inject = ['sandbox', 'sandboxPolicy']`，并通过 `sandbox.confine` 启动；本次不是仅有包版本变化。是否更换预装/联网策略不由此推导，本计划保留现有策略，只适配运行机制。

[目标桌面 manifest](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/apps/desktop/package.json)使用 Electron `^44.7.0` 和 electron-builder `^26.17.0`，本地目前是 `44.0.0` 和 `26.15.3`。推荐与目标原生加载器共同适配并固定实际解析版本，不单独升级 Electron，也不直接采用上游发布工作流。

## 实施顺序

### 1. 固定社区基线

先审核当前未提交改动和两个尚无等价补丁的提交，分别提交、合入或明确延期；不自动提交现有工作区，不把未提交改动复制进集成工作树。获取最新 origin/master 后重新确认基线与远端是否移动，保存备份引用，并重新生成冲突台账。建议分支名称为 `merge/upstream-0.2.1-alpha.2`，实施时若已存在就先检查，不覆盖。

### 2. 核心与数据先行

先处理包依赖、native loader、工具 native/ptc 类型、工作目录、Session 状态记录、Python PTC 沙箱，再处理子代理与 Agent Team。仓库内生产消费者、配置模板、SDK、快照和测试夹具一起迁移。旧 both 配置需明确提示并提供受控迁移，不能静默替换成行为不同的模式。删除 dshHome 字段不意味着删除用户目录；明确将指令目录解析交由进程环境，并验证 NAS 场景。

保留社区 v3→v4 历史迁移修复及外部事件身份处理，审核新增事件是否会使历史或新日志无法恢复；不通过宽泛接受未知必需事件绕开数据验证。迁移使用副本，源记录不改动；历史读取、继续、分叉、归档和导出都要验收。

### 3. 桌面启动与操作保持社区行为

保留社区 Supervisor、诊断入口、可选插件容错、客户端失败恢复、首次准备、Profile 锁、候选验证和回滚。市场常驻进程不得重新继承桌面事务委托变量；安装成功后由市场决定热加载或等待用户重启。正常启动不能因无关可选插件失败回滚成功的桌面目标操作。

修改/删除冲突默认逐项审查。社区替换掉的上游安装器、运行时准备脚本、策略登录测试及 CI 不整体恢复，只提取目标核心确实需要的原生加载、PTY 清理、路径安全和启动适配。上游 macOS 图标修复与社区已有修复对比后采用必要增量，不能恢复旧图标生成路径。

### 4. UI、NAS 与实验能力

整合字体、超长行预览、图片预览、后台任务及语音设备改进，保留社区手机断点、归档外观、模型搜索、审批解释与语言、设置按钮对齐、Agent Team 引导和关于页菜单入口。自动合并成功的文件也列入审核，尤其是系统提示词、HMR、webserver、主题、聊天和客户端加载。

NAS 保持 Beta 标记。验证 HTTPS/WSS、IPv6、认证与远程目录选择器一致，不能因允许远程连接而在 NAS 上弹原生对话框，也不能让本机 CLI/工具栏操作误指向远端文件系统。思考翻译默认不启用，提供文本发送到第三方服务和付费 provider 的说明；工作树插件也维持显式启用。

### 5. 预装、依赖和资源

对每个当前预装插件建立版本、归档、integrity、Host/Client 挂载和核心兼容记录，重点验证 better-sidebar、市场、skills-management、MCP 服务面板及远程控制集成。不修改第三方源码，不仅凭旧 peer 范围判定不兼容；真实失败再决定更换官方版本或调整预装集合。

manifest 冲突解决后用项目固定 pnpm 生成锁文件，检查非目标升级；不能整份选择任一方锁文件。重新生成预构建 Profile、资源清单、指纹与维修归档，验证 SSH helper、新 Worker、Python bootstrap 和原生模块是否进入发布资源。保留现有 Python/Office 来源和安装策略，防止无意重复装入资源包。

### 6. 文档与审核交付

按最终源码生成 API、Slot、配置和持久化目录，更新受影响的中英文说明与配对；不手改生成文档解决冲突。修复实际触发的文档检查失败。交付基线、冲突处理决策、社区行为检查表、预装兼容记录、测试结果、资源体积比较和未验证项；代码留在集成工作树待审核，不自动并回 master、推送或发布。

## 验收计划

| 范围 | 必须取得的证据 |
|---|---|
| 核心与依赖 | 相关聚焦测试、Host/Client 类型检查、lint、包依赖与文档检查通过 |
| PTC | 两种解释器来源；只读拒绝、工作区可写、权限审批、取消、超时；Windows/macOS/Linux 的实现差异列明 |
| SDK 与团队 | session/wait 的完成、失败、取消；团队直接 Inbox 投递；无旧 outbox 字段残留；SDK 录制输出更新 |
| 历史 | 发布版旧日志副本迁移、继续、分叉、归档、批量恢复；失败不损伤源文件 |
| 启动与市场 | 可选失败进入正常 UI；核心失败进诊断；未经确认市场重启 PID 不变；确认后单服务；候选目标失败才回滚 |
| NAS 与界面 | 认证/TLS/IPv6、远程目录选择；手机 320/390px 和 680/681px 边界；审批语言和社区归档保持 |
| 资源与安装 | 全新与升级配置、离线首次部署、中文和空格路径；原生 ABI、PTY 退出、Profile 完整性、包体积按组成统计 |

遵守既有约定，不运行 Playwright、test:web 或浏览器 replay。可采用聚焦单元测试、非浏览器的录制输出、隔离服务启动与人工界面验收。平台缺少实机证据时标为未验证，不将 macOS 开发模式通过等同于三平台发布可用。后续遇到平台局部问题时按影响范围决定重建，不强制所有平台重建；每份产物记录自己的构建提交与验证证据。

## 待实施前确认

推荐保留社区产品和资源策略；新增实验能力维持可选且不自动启用；目标固定 alpha.2 而非 master。社区发行版本号与公开发布权限另行确认，不因为上游版本更新自动更改已有发布准备记录。当前任务仅为调研和计划，尚未执行上述代码修改与运行验收。
