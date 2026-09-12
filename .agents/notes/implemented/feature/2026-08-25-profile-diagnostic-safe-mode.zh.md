# Agent Note: Profile diagnostics and safe startup

Status: implemented

[English](2026-08-25-profile-diagnostic-safe-mode.md) | 中文

## Problem

Profile 软件包安装与 Cordis 启动可能在不同层失败，但普通子进程文本无法可靠区分临时 registry 故障、不安全构建请求、用户配置错误或某一个有缺陷的外部插件。把所有 Loader 错误都视为隔离会掩盖根因，而对每次 ready 前退出都重复重试会延迟确定性故障，并可能让用户无法进入恢复所需的诊断界面。

恢复过程还必须保留两项安全属性：软件包生命周期脚本需要精确的用户决定，供应链等待期不能仅为了完成修复而被降低。

## Decision

`dsh/profile-diagnostic/v2` 是包管理器适配器、Profile 修复、CLI 启动、Cordis Loader 审计、Host 清单与桌面 UI 共用的 incident 格式。记录把产品诊断码与原始错误码分开，标明操作阶段和责任根，沿原始 cause 链保留错误，只声明受保护操作，并在移除凭据和本地路径后保存有界证据。尚未分类的错误仍会显示原始证据，但只提供导出操作。

自动修改仅限能证明失效或停用的状态：fallback link、陈旧 lockfile importer、中断的隔离残留、孤儿 bundle 引用、已知废弃 Loader 行，以及安全的 Host 单例重连。网络、registry 认证、文件占用和等待期失败继续作为可重试环境 incident。只有故障能明确归属且有界修复无法恢复时，才隔离外部根。诊断绝不清空或重写用户凭据和 patch 文档。无效设置文档在安全启动期间保持不动；独立且需要用户确认的恢复操作会先逐字节保留原文件，再只把该文档替换为空的有效映射。

活动外部 bundle 可以在软件包根目录发布 schema 版本为 1 的 `compatibility.json`，其中包含有界的精确 `supportedHosts` 版本列表。预检只读取这个固定数据文件，不执行插件代码。有效声明若排除了当前 Harness 版本，就足以在组合前隔离该根，保留当前版本、支持版本和可选推荐版本，并引导用户查找兼容更新。文件缺失、损坏、超限、使用符号链接或 schema 未知时均保持未知，不阻止启动。Host 不根据 `peerDependencies` 推断不兼容：预发布 semver 语义和宽泛兼容 range 不能可靠证明插件确实针对某个精确 Harness 代际经过测试。

客户端模块表导入失败包含足够身份信息，可以在不加载故障插件的情况下隔离：cause 链必须包含缺少供应者的不变量，外层错误必须标明 Loader entry 与模块，而且该行必须唯一映射到一个直接活动外部 bundle。服务端裸模块失败则沿完整 cause 链定位最深层 Loader import。只有最终 entry id 与模块名完全匹配唯一一个直接启用外部 Bundle 的原始声明，并且 Profile 与 home 用户 patch 都没有触及该 entry 时，系统才会自动隔离。Loader 模块自身缺失时记录 `loader-module-unresolvable`；Loader 模块可解析、但其静态或运行时导入继续请求另一个不可用软件包时，记录 `loader-dependency-unavailable`，同时保留导入方与缺失包。内部 Host 包缺失会作为 DSH 代际不兼容处理，修复绝不把它安装进 Profile。来源有歧义或用户修改过的组合仍保持不动并进入安全模式。无框架浏览器内核只把封闭的客户端错误形态通过经过认证的 Host Remote 上报，保持加载页可见并等待桌面监督器。CLI 只移除经过证明的根，运行内置包管理器，复查软件包残留、孤儿 bundle 与 Host 身份冲突，并保留其说明符和 bundle 位置供重试。监督器随后重启普通 Profile，让用户进入主界面并在诊断页看到隔离记录；无法完成验证时恢复 manifest，并改用安装自带的安全 Profile。

每次 `allowBuilds` 变更都是独立的精确键操作。失败的包管理器输出保留 pnpm 给出的精确 registry 包或 Git artifact 键。UI 在白色弹窗中展示根来源、键和风险，保留红色警告图标；黑色确认按钮只写入该键并重试原操作一次。取消不会改变任何策略。Profile 修复绝不设置 `minimumReleaseAge=0`，也不会允许全部构建。

桌面启动通过 `DSH_PROFILE_SAFE_MODE_ON_FAILURE=1` 明确选择安全模式恢复。正常 Profile 的确定性故障会写入 incident，并输出一条稳定 stderr 标记。监督器立即使用 `DSH_PROFILE_SAFE_MODE=1` 重启一次；CLI 随后只组合安装自带模板 bundle，忽略 Profile manifest、外部 bundle 和用户 patch 层，并把 settings provider 指向安装方维护的空文档且关闭监听。会话持久化、持久存储和附件也会被重定向到本次调用独占的全新空目录，诊断进程结束后即删除。这样，单个损坏 Session 不会再次击穿恢复进程，Workspace 初始化也不会把空投影写进真实元数据；原始用户数据始终保持不动。裸模块从安装方维护的 `$DSH_HOME/profiles/node_modules` fallback 开始解析；开发版使用受控 symlink，安装版使用只包含安装依赖闭包的模块代理。安全模式记录已跳过用户设置和用户数据，并提供普通诊断 UI。会话损坏使用独立的非插件诊断码，绝不能作为自动隔离插件的依据；本机 Harness 日志会保留损坏文件的精确路径，而面向客户端的证据仍会移除本地路径。启动被限制为一次普通尝试和一次安全模式尝试；安全模式自身失败时监督器立即停止，保留原始 incident 为主证据，并把安全模式错误追加为次级证据。

Host 清单把持久 incident 与实时失败或未解析 Loader entry 合并，并通过生成的 Remote 方法提供精确授权、修复、隔离、恢复、卸载和导出操作。卸载已停用的隔离插件时，系统先清理该插件的陈旧 lockfile importer 与软件包残留，再只从修复报告和当前诊断报告中移除属于它的状态，最后删除持久隔离记录；其他 incident 保持不变。只有当前 Loader 把软件包根标记为活动状态，并且直接依赖、有序 Bundle 条目与已安装软件包清单同时存在时，系统才把插件视为已经恢复；清单收敛随后删除其过期隔离记录和对应诊断元数据，不删除活动软件包，之后若要卸载仍必须走受控包管理操作。预检还会识别插件已停用且物理安装消失、持久隔离记录也已删除、但上述派生记录仍然存在的状态，以 `profile.quarantine-removal-residue` 报告并安全收敛元数据，不会重新隔离已经移除的插件。浏览器只显示当前 incident。完整双语规则总表位于 [`docs/profile-diagnostics.zh.md`](../../../../docs/profile-diagnostics.zh.md)，导出内容包括机器可读规则清单与版本、脱敏 incident、运行时事实、隔离记录和 Loader 摘要。

插件 CLI 和普通 Profile 启动都会先准备模块回退映射，再运行诊断。即使是全新的数据目录，也必须在静态导入预检前使安装目录的依赖闭包可见；否则，可用的内置服务会被误判为缺失的第三方依赖，并导致使用它的插件被隔离。准备过程复用现有带锁的回退映射写入器，不会向 Profile 安装另一代 Host。

## Alternatives considered

**只在 Diagnostics React 组件解析文本。** 这会把策略复制到不可信的展示层，丢失原始 cause 链，而且启动故障时浏览器根本没有挂载，无法提供结果。

**自动授权 Git `prepare` 和已知原生包。** 这种做法安装更方便，却把包管理器安全决定变成不可见副作用。即使上一次安装已经暴露所需键，也仍保留精确确认。

**清理时关闭 minimum release age。** 进程局部覆盖能让停用依赖消失，但会削弱报告 incident 的同一条供应链规则。对已停用根执行有界直接清理，比放宽解析策略更安全。

**恢复前始终重试三次。** 确定性的 Profile 与配置故障不会因相同启动重复而改善。稳定标记允许立即尝试一次安全模式，同时不消耗普通重试预算。

**根据 peer dependency range 推断兼容性。** 这能覆盖未发布兼容声明的旧插件，但预发布 semver range 往往会接受从未测试过的后续候选版，因而可能隔离原本可用的插件。只有插件自有的显式元数据可以作为执行前阻断信号。

**在原 Profile 中把全部外部行原地禁用后启动。** Profile 本身的解析或组合可能就是故障，而且界面启动前编辑它存在数据丢失风险。安装自带组合避开损坏输入，并把原文件保留给显式修复。

## Consequences

用户可以在不削弱包策略、不删除配置的情况下进入应用并检查失败的外部 Profile。支持导出不携带密钥或绝对用户路径，诊断也能区分“插件已隔离”和“插件为何被隔离”。

实现需要维护第二套刻意精简的启动组合，以及一个版本化 incident 文件。新的 pnpm 或 Cordis 故障需要分类器和聚焦 fixture 才会获得专用产品诊断码；在此之前仍以 `profile.unknown` 可见。安全模式只提供诊断，不提供普通第三方功能；安装自带模板损坏时仍需使用启动失败页。

聚焦覆盖固定分类、cause 归属、脱敏、精确构建授权、等待期保护、安全 Profile 组合、监督器回退、实时 Loader 投影、Remote 导出和诊断展示。桌面启动验收还必须检查新增 Harness 日志中的 ready 标记、可访问的客户端 URL 和持续存活的 Electron 进程。
