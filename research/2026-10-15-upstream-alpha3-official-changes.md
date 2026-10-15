# 官方 0.2.1-alpha.3 更新与社区合并风险

## 范围和结论

本报告是 2026-10-15 的只读源码审查记录，不代表完成合并或运行验收。比较目标固定为官方 `dsh-v0.2.1-alpha.3`，前版为 `dsh-v0.2.1-alpha.2`；社区基线为当前 master，与已发布 `odsh-v0.2.1-alpha.2` 的源码提交一致。本节以下区分上游已声明或源码可见的变化，以及需要社区验证的风险推断。

总体风险较高，不适合直接接受整份上游文件或只按 Release 功能表处理。优先阻断项是 NAS 身份授权、插件更新与 HMR 生命周期、旧配置拒绝加载，以及社区构建资源闭包。Python SDK 的按需下载调整不等于要求社区桌面移除预装 Python/Office。

## 官方 Release 的产品变化

官方 Release 发布于 2026-10-14 13:32:15 UTC。主要新增包括本机 HTTP 登录 DeepSeek、已发送消息密钥默认脱敏、极简模式图片和自动压缩、Web/桌面 `/compact`；优化包括账号模型目录动态更新、子代理独立 preset、Office 指引按需加载、终端输入可靠性、统一字号快捷键，以及可选的 Node PTC 内存常驻执行模式。会话继续、历史兼容、插件更新仍运行旧代码、Web 拥塞误断线和持久化卸载丢失最后记录均有修复。[官方 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.3)

Release 的“其他变更”还明确列出凭据优先级改变、Azure 提供方更名、Python SDK 的 Office/完整创作环境按需下载、重建自定义 Profile 会替换原配置，以及 TypeScript/Python SDK resume。不能把这些仅当作说明文字更新。[官方 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.3)

## 明确的配置和 API 不兼容

| 范围 | 已确认的上游变化 | 对社区的风险与处理要求 |
| --- | --- | --- |
| DeepSeek 账号模型 | `llm-deepseek-account.config.models` 不再允许，存在时插件拒绝加载；目录来自账号 `GET /models`，覆盖使用 `modelOverrides`，不支持的模型以 `CLIENT_UPGRADE_REQUIRED` 拒绝。 | 导入的旧配置或用户编辑过的模型目录可能让账号模型整体消失；需要迁移和准确诊断，不能直接删除用户定制。 |
| 凭据 | Web/桌面已保存凭据优先于环境变量；随附 headless 默认不挂载凭据存储和账号提供方。 | 同一 NAS/桌面启动环境可能换用另一账号；headless 过去仅靠已保存凭据的任务可能失败。测试只检查来源和存在性，不打印密钥。 |
| 子代理 | 拒绝 `persona`、`toolFilter`；spawn 使用 `agentPreset`/`allowedAgentPresets`；fork 只能继承父 preset。 | 自定义 preset、社区工具设置与委派提示必须同步；旧字段不能猜测映射为另一种工具限制。模型和推理强度选项仍保留。 |
| 插件安装 | HMR 开启时，对已安装包再次 `installBundle` 返回 `already-installed`，不修改 Profile；官方“更新”先 remove 再 install。 | 社区候选事务、市场检查、失败回滚不可简单替换为两条非原子调用；`ManagementError.code` 的穷尽处理需新增分支。 |
| JSONL 持久化 | 改为命名空间函数插件，无默认导出；不能直接 new、继承或 instanceof 原服务类。YAML 和存储文件不变。 | 仓库内测试、直接服务消费者与第三方插件可能启动失败；异步消费者清理必须保留到提供方卸载完成。 |
| 后台 job | 注册表和持久事件统一使用同一 `JobId`，格式改为 kind 加 16 位 UUID 十六进制后缀，不再携带 `executionId`。 | 不能按 kind/序号构造 ID；SDK、任务卡片、持久事件读取和取消调用需更新。旧历史不因此恢复运行中的 job。 |
| Azure | 提供方名 `azure-openai-responses` 改为 `azure`；Responses API 名和 `AZURE_OPENAI_*` 环境变量名不变。 | 模型选择、默认模型和提供方配置需要迁移；自定义部署不能靠未知模型名猜协议，历史 Session 事件不可改写。 |
| 账号 identity watch | `DeepSeekAccount.watch(signal)` 默认不通知 Platform 身份补齐/变化；相关消费者要传第二参数 `true`。 | NAS 登录、平台身份和模型刷新消费者可能表面在线但状态未更新。 |
| 非页面 Connection | 默认 `interactions: 'none'`，不打开 `$events`，不提供 `$on()`/`$stream()`；需要回答交互时显式选择 `answer`。 | 社区桥接、非页面 SDK/控制端如果沿用浏览器流恢复逻辑，可能失去审批事件或无法重连。 |
| 自定义 Profile 重建 | `--from-default-profile` 会替换已存在的目标 Profile 及插件、设置。 | 导入/维修调用需要逐项审查，不能继续理解为“只补缺失文件”；本审查未证实社区生产路径已经触发此行为。 |

上述事实来自目标版本升级指南：[账号模型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/docs/upgrade-guide/v0.2.1-alpha.2/deepseek-account-model-catalog/guide.zh.md)、[凭据](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/docs/upgrade-guide/v0.2.1-alpha.2/stored-credentials-precedence/guide.zh.md)、[子代理](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/docs/upgrade-guide/v0.2.1-alpha.1/subagent-preset-composition/guide.zh.md)、[安装已有插件](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/docs/upgrade-guide/v0.2.1-alpha.2/plugin-install-over-installed/guide.zh.md)、[JSONL](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/docs/upgrade-guide/v0.2.1-alpha.1/jsonl-persistence-plugin/guide.zh.md)、[job ID](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/docs/upgrade-guide/v0.2.1-alpha.1/job-id-identity/guide.zh.md)、[Azure](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/docs/upgrade-guide/v0.2.1-alpha.2/pi-ai-azure-provider/guide.zh.md)、[identity watch](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/docs/upgrade-guide/v0.2.1-alpha.2/deepseek-account-identity-watch/guide.zh.md)、[Connection](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/docs/upgrade-guide/v0.2.1-alpha.2/operator-connect/guide.zh.md)、[Profile 重建](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/docs/upgrade-guide/v0.2.1-alpha.2/from-default-profile-replaces-target/guide.zh.md)。目录名表示变更前版本，不表示这些指南与 alpha.3 无关。

## 未在 Release 标题中充分体现的高风险变化

### 远程身份、RBAC 与 NAS

上游 Peer 生命周期固定 `principal`；RPC Host 的 `createPeer` 要求调用方传入主体，浏览器 owner 与其他主体有不同权限，非 owner 访问部分端点会被拒绝；新增 remote-access 按资源授权。这是源码可见的安全模型变化，不仅是本机 HTTP 登录功能。[Peer](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/packages/client/connection/src/peer.ts)、[RPC Host](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/packages/client/connection/src/rpc-host.ts)、[Remote access](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/packages/api/remote-access/src/index.ts)

社区风险推断：NAS 设备认证如果只沿用“已认证即可调用”而不明确映射 principal，可能让本应受限的设备获得 owner 权限，或者反向导致全部请求 403。现有 NAS 设备原本可能就是完整操作身份，映射为 owner 并不单独证明存在漏洞；需要明确保留旧权限还是引入受限角色，不能暗中改变语义。需要分别验证本机 owner、NAS 已授权设备、非 owner、断线重连、事件订阅和远程目录选择；不能以关闭 RBAC 适配。

### 插件更新、HMR 与重启

上游增加包文件变化检测，更新/重装后重新组合 Profile，并对不能替换的插件报告重启原因；`watch-config`、模块文件跟踪和插件管理同时变化。[HMR](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/packages/boot/hmr/src/index.ts)、[包文件检测](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/packages/boot/hmr/src/module-files.ts)、[插件管理](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/packages/boot/plugin-manager/src/index.ts)

社区风险推断：新的自动重组不能重新引入市场未经用户确认的桌面重启，也不能跳过候选目标验证。保留社区轮询时，需要与上游 watcher 关闭、失效检测、重启原因一起整合，而不是同时运行两套监听。验收需记录安装前后 PID、插件实际代码版本、持锁等待和失败回滚结果。

### 构建与第三方插件

上游构建拆分 `artifacts`、`check`、`typecheck` scope；客户端新增构建环境处理，依赖和共享客户端库布局调整，桌面 sharp 固定到 `0.35.5`。[构建入口](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/scripts/build.ts)、[客户端构建环境](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/scripts/client-build-environment.ts)、[桌面 manifest](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/apps/desktop/package.json)

社区风险推断：Node/Browser 两类导出、共享运行时、Worker/动态 import 和社区资源筛选必须一起验收。开发模式通过不代表离线安装版闭包完整；需要重建 Profile、指纹和维修归档，再在中文/空格路径运行。旧第三方插件可能依赖默认导出、旧 Connection 或子代理字段，不能仅依据 peer 范围判定可用，也不能未经授权修改第三方源码。

## 会话历史与 SDK

目标版本仍写 Session format `4`；已知事件表新增 `job/registered`、`job/settled`。SDK 的 resume 恢复原 Session ID 和工作目录，JSONL 卸载时的资源保留和最终记录写入顺序也有变化。[Session 类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/packages/core/session/src/types.ts)、[已知事件](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/packages/core/session/src/known-event-types.ts)、[SDK Server](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/packages/sdk/server/src/server.ts)、[JSONL 实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/packages/session/session-persistence-jsonl/src/index.ts)

此前用户遇到的 v0 `source summary requires notice form` 不能宣称已由 alpha.3 修复：alpha.2 到 alpha.3 的 `session-format-v0-to-v1` 仅 manifest 版本发生变化，校验源码未改变；目标源码仍在非 `notice` form 带 `summary` 时抛出该错误。这一结论是静态对比，不是拿真实旧日志运行后的复现结果。[对应校验源码](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/packages/session/session-format-v0-to-v1/src/payload-validation.ts#L633-L654)

需要用旧数据副本分别验收 v0/v3/v4 读取、继续、分叉、归档、导出、异常退出后的“任务已停止”，以及 SDK resume/取消。保留社区已有历史事件修复，不修改源日志或冻结的历史格式来绕过拒绝。

## Python、Office、PTC 和原生能力

Node PTC 新增 `executionMode: 'persistent-in-memory'`，默认仍为 `per-call`；源码说明按 owner 保留执行环境并遵守相同文件策略，相关代码增加取消、权限变化与进程清理协调。此模式不意味着默认启用，也不意味着 Python 必须改为预装或下载。[配置](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/packages/ptc-runtime/ptc-runtime-node/src/config.ts)、[持久执行实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/packages/ptc-runtime/ptc-runtime-node/src/persistent.ts)

官方 Release 的按需下载条目针对 Python SDK 的 Office 引擎和完整创作环境；SDK 资源校验不再要求 `office-skills/scripts/check_office.py`。共享 primary-runtime 准备逻辑也改变 Python 别名处理和内容指纹。社区既定桌面 Python/Office 部署策略应保持，更新资源准备和验收适配，不能照抄 SDK 裁剪规则。[Python SDK 资源校验](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/python/sdk-runtime/src/deepseek_harness_runtime/_resources.py)、[Primary runtime 准备](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/scripts/primary-runtime/prepare.ts)

新增实验性原生 macOS CUA 采用 Swift helper，文档要求 macOS 14+、辅助功能/屏幕录制权限，默认 Profile 不加载。它与 PTC 变量持久化是两个独立组件。社区不应因合并而自动启用、下载或要求用户安装 Swift；若以后支持，需要单独确定二进制构建、签名、权限和更新策略。[官方 CUA 文档](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/packages/experimental/cua-macos/README.zh.md)

Agent Team 本体生产源码在这次比较中没有变化，主要是说明和测试；但其依赖的子代理、Connection 身份和生命周期已变化，因此不能因此跳过团队首次启用引导、成员身份、任务投递和取消的回归。[Agent Team 目录](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-alpha.3/packages/experimental/agent-team)

## 证据范围

本记录读取官方 Release API、固定标签源码、升级指南、两标签的路径/内容差异。未运行 alpha.3、未安装插件、未请求模型、未迁移用户会话，也未执行原生构建。因此报告中的运行风险仍需隔离验证，不构成三平台可发布证明。三方合并冲突和社区行为保留清单由后续章节单独记录。

## 实测三方合并冲突

社区 master 已包含完整 alpha.2。对固定社区提交和固定 alpha.3 标签运行 `git merge-tree --write-tree --name-only HEAD dsh-v0.2.1-alpha.3`，返回 1 表示存在冲突；命令仅生成 Git 对象，没有修改工作区或索引，也没有开启实际 merge。上游增量为 852 个提交（含 merge）、3,311 个变更文件、120,978 行增加和 16,632 行删除；文件数不是人工冲突数。

模拟列出 167 个冲突路径，其中 57 个为修改/删除冲突。上游继续修改了社区已替换或删除的桌面构建、更新及测试文件，不能将这些路径全部恢复。主要分布如下，其余路径为根配置、清单、文档及生成目录。

| 范围 | 冲突路径数 | 重点 |
| --- | ---: | --- |
| `apps/desktop` | 57 | `main.ts`、manifest、上游安装器/更新器、原生运行时准备和签名测试 |
| `packages/client` | 42 | Connection 认证、聊天布局、图片、账号与模型设置、主题、插件恢复页 |
| `packages/boot` 与 `packages/bundle` | 10 | Profile 组合、HMR 轮询、Web/NAS 启动与依赖 |
| `.agents/notes` | 9 | 桌面打包、资源、更新与验收说明；归档文档不能当作当前机制直接恢复 |
| `packages/host` | 4 | Webserver 说明和插件清单依赖 |
| `packages/subagent` | 4 | preset 委派接口和说明 |

双方修改路径交集为 334，其中 169 个没有文本冲突。`hmr/src/index.ts`、`plugin-manager/src/index.ts`、`core/session/src/known-event-types.ts`、`core/system-prompt/src/index.ts`、`host/webserver/src/index.ts` 和 SDK Client 都在这一类；自动合并成功不能作为行为保留证据。

## 社区实现的重点风险与推荐处理

| 优先级 | 社区范围 | 推荐处理与通过条件 |
| --- | --- | --- |
| 高 | NAS 认证与远程权限 | 保留设备配对、撤销、可信入口和 TLS；显式决定现有设备的 principal/权限语义，验证 HTTP、WebSocket、事件、列表和文件资源一致。不能用放宽所有请求来消除 403。 |
| 高 | 市场、候选安装和 HMR | 保留“市场决定热加载或等待确认重启”、修改锁、Supervisor 外部写入等待和候选目标验证。覆盖更新的先移除再安装失败、中断和回滚；新 `restartReason` 不能被当作立即重启授权。 |
| 高 | 旧配置和用户数据 | 备份后仅迁移可证明等价的字段，无法映射则显示具体失效项；保持原会话不改写。社区桌面当前未发现 `--from-default-profile` 的调用，不把该语义风险描述成现有数据丢失事故。 |
| 高 | 桌面壳和原生安装 | 保留社区入口、诊断、数据目录、macOS 窗口、CLI 菜单、关于页及 GitHub/CNB 更新来源；逐项提取上游必要修复，不恢复官方发布/签名工作流。 |
| 高 | 构建和离线资源 | 新的 `./client` 条件导出从单一 `lib/client.js` 变为 Node/Browser 双文件；同步构建和资源筛选，重建 Profile、指纹与维修归档，验证解压迁移、离线首次启动及离线插件维护。不能复用 alpha.2 模板作为 alpha.3 验收。 |
| 中高 | 自定义提示词、审批和手机 UI | 审查系统提示词自动合并结果；保留中文审批解释、命令详情折叠、手机抽屉、归档搜索/分组/筛选、模型搜索、团队“去使用”和首次引导。验证聊天折叠与流式更新不增加内存或滚动回退。 |
| 中高 | 第三方预装插件 | 对市场、better-sidebar、IM、skills-management、MCP 面板等逐项安装和挂载，验证旧 Connection/子代理/存储 API 使用；兼容声明只作提示，不替代实际结果，不修改第三方源码。 |
| 中 | Python/Office 与新实验能力 | 保留现有桌面预装策略和官方 Office 来源，仅适配资源检查。Node PTC 内存模式和原生 macOS CUA 保持显式启用；不将社区下载任务自己的 UUID `jobId` 机械改成核心 JobId。 |

条件导出变化的来源是[目标 Connection manifest](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/packages/client/connection/package.json)；社区风险判断依据当前[认证适配](../packages/client/connection/src/index.ts)、[浏览器认证](../packages/client/connection/src/browser-auth.ts)、[桌面运行时任务管理](../apps/desktop/src/workspace-runtime-manager.ts)、[打包资源约束](../apps/desktop/scripts/packaged-resource-contract.json)及[社区构建配置](../tsdown.config.ts)。

## 后续合并的建议顺序

建议批准后在独立工作树合入固定 alpha.3 标签，不直接合上游 master。先处理构建依赖与条件导出，再处理 Connection/RBAC/NAS、Profile/HMR/市场事务、配置迁移/历史/SDK，最后整合 UI、预装插件、文档和原生资源。社区发行版本、预装部署策略及公开发布权限仍单独决定，本次调研不改变它们。

允许合回主分支前，至少取得以下证据：旧配置副本升级且重复执行不覆盖用户设置；受影响旧会话读写和 SDK resume；市场未确认时 PID 不变、确认后单服务、目标失败回滚；NAS 身份/权限/撤销和远程目录；托管/自定义 Python 与 Office 预览；中文和空格路径下离线部署及插件维护；保留社区手机、归档、审批和模型搜索行为。

验证采用相关聚焦测试、Host/Client/桌面类型检查、lint、文档检查、社区构建和隔离原生启动；按既有约定不运行 Playwright、`test:web` 或浏览器 replay。缺少平台实机或安装包验收时明确列为未验证，不能只凭文本合并完成宣称三平台可发布。
