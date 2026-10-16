# alpha.4 运行时、插件与 NAS 合并风险

参考范围：官方固定标签 `dsh-v0.2.1-alpha.3` → `dsh-v0.2.1-alpha.4`；社区主分支及已发布 alpha.3 打包分支。本文是源码和归档元数据调查，不是安装、激活或跨平台运行验收；实际文本冲突以主任务的三方模拟台账为准。

## 1. 插件版本准入：必须一起迁移调用方

alpha.4 优先读取插件自己的 `engines.dsh`：字段存在时只用它判断，不再同时要求 DSH peer 匹配；不存在时仍检查所有 DSH peer。空范围、无效范围或不合法字段不自动通过，`includePrerelease: true` 保留。alpha.3 已存在 peer 准入，因此不能将 alpha.4 描述成“首次禁止旧 peer 插件”。来源：[兼容性实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/boot/app-boot/src/plugin-compatibility.ts)。

公开结果 `PluginCompatibility`、`IncompatiblePlugin` 的 `peers` 字段改为 `requirements`；安装预查询补读 `engines`，安装后的检查仍能拒绝并恢复原依赖。迁移 Host、Client 错误呈现、CLI、测试和生成目录，不能仅解决类型报错或把所有拒绝转成警告。版本豁免仍是精确插件版本与运行时版本配对，不能直接把 alpha.3 授权扩大到 alpha.4。来源：[类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/boot/plugin-manager/src/types.ts)、[安装操作](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/boot/plugin-manager/src/operations.ts)。

只读检查仓库归档及已发布 alpha.3 的实际 Windows 快照（run `38721827443`）后，九个 `startup` 插件没有显示必须为了 alpha.4 全部换版的证据。发布快照只有 `@weibaohui/skills-management@0.9.1` 声明 `engines.dsh`（`>=0.1.7-rc.2`）；其余走旧 peer 或无 DSH 声明路径。仓库中的预装归档不一定等于 CI 发布时解析的快照，不能用源码清单的旧版本代替实际已发布版本。元数据通过不等于 API 或挂载兼容，保留完整预装 Host/Client 激活验收，特别是 better-sidebar、dshmarket 和 MCP 面板；不修改第三方源码、不批量授予豁免。社区依据：[发布快照清单](../.artifacts/release-snapshot-audit/38721827443/manifest.json)、[仓库预装清单](../apps/desktop/bundled-plugins/manifest.json)。

## 2. 官方新市场：与现有社区市场共存和权限整合

上游新增可选 Custom plugin markets bundle、Discover UI、`pluginMarket` Host 服务、只读 `plugin_market` 工具和独立索引生成器，不是删除或替换社区 `dshmarket`。默认索引列表为空，启用 bundle 后仍需用户配置来源。索引支持 npm 的精确包版本/可选 registry，及固定完整提交的 HTTPS Git/可选子目录；展示用 repository 字段不是安装源。来源：[bundle](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/experimental/plugin-market-bundle/cordis.patch.yml)、[服务](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/boot/plugin-market/src/index.ts)、[索引类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/util/plugin-market-index/src/types.ts)、[安装目标](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/util/plugin-market-index/src/index.ts)。

索引来源允许不带凭据或 fragment 的 HTTP(S)，并非 HTTPS-only；fetch 拒绝重定向并限制超时和体积。市场元数据不是信任证明，也不能当成指令；真正安装仍通过已有管理路径及其授权/兼容检查。上游工具明确只有用户能增删索引来源，模型工具本身只读。保留社区市场用户确认重启和桌面候选授权隔离，不让新的 Discover 安装绕开这些机制。来源：[URL 校验](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/boot/plugin-market/src/index-url.ts)、[工具](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/boot/plugin-market/src/tools.ts)。

NAS 当前非管理员允许清单不含 `pluginMarket/listIndexes`、`pluginMarket/search`、`pluginMarket/setIndexes` 或 `event:plugin-market/changed`，合入后默认拒绝是安全结果，不是应当取消的权限检查。建议管理员才管理来源及安装；非管理员先按现有策略隐藏管理入口并显示权限说明。如果产品要允许它们浏览目录，另行逐项加入只读 RPC 和事件，绝不顺带放开 `setIndexes`。新增索引的服务端 fetch 还意味着管理员可让 NAS 主机访问配置的 HTTP(S) 地址，应明确可信管理员范围，不宣称上游提供私网地址隔离。社区依据：[NAS 策略](../packages/client/connection/src/nas-policy.ts)。

## 3. 跨 Host 版本客户端更新：保留用户确认，不混装

Host boot graph 新增 `release: { version, commit? }`。已打开页面只应用与启动时两字段都相同的 Host 图和 rebuilt frame；跨版本暂停并提示刷新，关闭提示不解除暂停。应与社区自动恢复、断线重连、NAS 地址切换、市场重启后的恢复一起测试，避免旧页面导入新 Host 模块或无限重载。Host/Client 构建提交标识必须一致，不能只有桌面 About 版本改对。来源：[release-change](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/client/modules/src/client/release-change.ts)、[entries](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/client/modules/src/client/entries.ts)、[Host 图](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/client/modules/src/index.ts)、[构建元数据](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/scripts/client-build-environment.ts)。

## 4. Linux、SSH、Codex：应提取的修复

Linux containment 新增正负探测缓存和失效条件，减少 fork/spawnSync；scope 未启动目标、user-manager listener 或 systemd-run 变化时按规则重探测。兼容旧 systemd 不支持 `--expand-environment=no` 的情况，使用 `--kill-who=all` 兼容旧版本。不能将其简化成永久缓存或删除探测。验收覆盖有/无 user systemd、manager 重启、字面参数、普通进程/PTY、启动失败与后代清理；macOS 不能替代这些 Linux 证据。来源：[selector](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/subprocess/subprocess-local/src/linux-scope-selector.ts)、[scope](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/subprocess/subprocess-local/src/linux-scope.ts)。

SSH helper 将顶层 await 包入异步 main；仍保留信号取消、stderr 和失败退出码 127，不是替换 SSH 协议。需要保留社区发布资源闭包及 helper 打包验证。Codex runner 接受新 `partial_answer`，输出优先级为最新 final、否则最新 partial、否则无 phase，仍不把 commentary 当答案；应整段迁入并保留外部工具失败诊断，不必据此强迫升级所有用户 Codex CLI。来源：[SSH](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/ssh/ssh/src/helper-entry.ts)、[Codex wire](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/subagent/subagent-codex/src/wire.ts)。

## 5. Office、配置与历史数据

本次 Office 实际增量主要是操作说明：检查后移除的临时预览不应在回复里链接；PDF 导出通常只校验结果、非空和 `%PDF-`，不额外寻找 PDF reader。`desktop-host/office.ts` 只有描述变化，没有引擎安装或加载算法变化。因此维持社区现有 Python/Office 部署策略，没有“必须换引擎”的源码依据。来源：[office-render](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/skill/skill-office/assets/office-render/SKILL.md)、[office-export-pdf](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/skill/skill-office/assets/office-export-pdf/SKILL.md)、[Desktop Office](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/apps/desktop-host/src/office.ts)。

对固定标签的 core/session/storage 路径差异检查显示主要是包版本更新；未发现该范围 Session writer、历史迁移器或 SQLite schema 的新增实现改动，也没有新增 `docs/persistence-changes` 记录。不能宣称 v0 `summary requires notice form` 被修好；保留原有限制与历史修复。新的持久配置主要是市场索引来源和可选 bundle。真正新增 API/协议兼容风险集中在上文 requirements 字段及 boot graph release 标识，而不是重新设计历史迁移。来源：[alpha.3→alpha.4 比较](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.1-alpha.3...dsh-v0.2.1-alpha.4)。

## Dev Note

调查仅执行 Git diff/show、源码搜索和 tgz package.json 读取；未安装插件、未运行测试、未下载外部依赖、未切换分支、未执行合并或推送。文本冲突数量由主调查统一记录；上述条目同时包含可能自动合并成功的语义风险，不能直接当作冲突文件数。
