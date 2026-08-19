# Agent Note: Profile 共享 Host 依赖健康

Status: implemented

[English](2026-08-19-profile-shared-host-dependency-health.md) | 中文

## Problem

树外 profile 插件可能把 Harness Host 包声明为普通依赖。pnpm 随后会在 profile 下方安装另一个物理副本，而 Node 会让插件 import 优先解析到该副本，而不是安装目录自有的运行时。版本相同并不代表实例可互换：Cordis 服务、上下文和导出的 symbol 都依赖模块身份。停用插件仍会留下已安装的依赖树，因此 profile 可能继续出现工具调度器缺失或 `Cannot read properties of undefined (reading 'prepare')` 等症状，直到重复包被移除。

## Decision

共享 Host 依赖健康是默认的 profile 启动能力，不是可选插件。受保护集合首批包含 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-attachment`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-system-prompt` 与 `@deepseek-ai/dsh-tools`。

检查从每个 profile 直接依赖开始，递归跟随已安装的 `dependencies` 与 `optionalDependencies`。合法的 `peerDependencies` 声明不构成冲突。对于每个受保护包，检查器会比较插件解析到的 real path 与安装目录自有 real path，因此版本相同的影子副本仍会被发现。诊断保留根插件、依赖链、声明范围及位置、Host 版本、兼容性与两条路径；客户端投影不会暴露文件系统路径。

每次 profile 启动都会在组合前检查。新 profile 会关闭 pnpm 的 peer dependent 去重，修复也会在运行包管理器前迁移现有 workspace 设置。否则，pnpm 11.7.0 会针对带链接 Host provider 的 hoisted 依赖图进入 `inheritedParentPkgBreaksPeerDiamond()`，并可能对缺失的 peer 元数据调用 `Object.keys()`。修复还会裁剪 `pnpm-lock.yaml` 根 importer 中 manifest 已不再声明的条目，避免之前中断的物理隔离把已停用根依赖带入下一次插件改动。除此之外健康的 profile 不运行包管理器。发现冲突时，修复会通过保留注释的 YAML document 把 Harness 保留的 `link:` override 合并进 `pnpm-workspace.yaml`，运行调用方随附的 pnpm，然后重新检查。无关配置与 override 仍归用户所有。如果根插件的范围拒绝 Host 版本，或收敛失败，该根插件会从依赖和 bundle 顺序中移除，并把可重试记录写入 `$DSH_HOME/quarantine/profile-plugins.json`。只有根插件目录也已经不存在，隔离才算成功。裁剪已安装 lockfile 时若被 minimum-release-age 拒绝，系统会用仅对当前进程生效的 override 重试一次；保留的报告还会恢复 manifest、lockfile importer、软件包目录与持久记录不一致的中断清理。如果 pnpm 在恢复这个已知停用状态时崩溃，Harness 会只直接删除保留记录中的根插件、移除其过期 importer 条目，并把 profile 本地共享 Host 包重新链接到安装目录副本，然后再次检查。如果无法证明最终依赖树干净，启动会失败关闭。

成功的 `dsh plugin` 改动后也会运行同一修复策略。`dsh plugin --profile <name> doctor` 只读运行；`--repair` 通过普通策略执行修改，`--retry <quarantine-id>` 则以事务方式恢复记录中的说明符与 bundle 位置。Electron 与 Web Settings 会注册第一方的“诊断”分区，与“插件”清单标签和 `dshmarket` 都保持独立。该页面可以运行一次新的只读 doctor、明确启动修复、投影不含文件系统路径的结构化冲突和失管项结果，并管理保留的修复通知与隔离记录。冲突报告中的活动根插件会在用户明确确认风险后，使用核心结构化 `dsh plugin remove` 后台任务；失管 Loader 条目已不存在可管理依赖，因此不会提供该操作。只有当软件包已同时离开 profile 依赖和 bundle 顺序时，系统才接受残留卸载；第二次明确确认后，系统先删除顶层已安装软件包，再清除记录。这覆盖 Electron、`dsh web`、Web 快捷方式，以及所有通过 `runProfile()` 启动的其他入口。

## Alternatives considered

- **纯客户端检测：**否决，因为 CLI 与官方 Web 启动可能在客户端存在之前就组合损坏的 profile，并且每个客户端都会重复包管理器策略。
- **纯插件：**否决，因为必须在 Cordis 加载插件之前令冲突插件图变得安全；doctor 插件只能在跨过它要保护的边界后诊断，而且自身也可能被移除或损坏。
- **核心守卫加可选 doctor 插件的混合方案：**暂缓，因为核心守卫已经拥有所有安全关键操作。未来可以为上游 Harness 用户发布独立插件，提供更丰富的报告，但它不能成为安全启动的必要条件。
- **只警告、不修复或隔离：**否决，因为已知故障会破坏运行时身份，并产生误导性的下游工具错误；继续运行并不是安全的降级模式。
- **始终卸载问题插件：**否决，因为隔离会保留原始依赖说明符、bundle 位置、诊断和显式重试路径。

## Consequences

profile 启动增加一次快速依赖图与 real path 检查；只有发现冲突后才安装包。Harness 拥有受保护包集合对应的 override 键，并可能从活动 profile 移除不兼容插件，但会保留足够状态用于重试。修复、隔离和失败都是版本化的结构化结果，UI／包管理器调用方可以将它们与普通安装成功区分开来。

测试覆盖直接、传递、可选、peer 和同版本物理冲突，以及 YAML 保留、收敛、不兼容与修复失败后的隔离、重试回滚、CLI 只读行为、Host 投影与任务、Settings 通知与操作。跨平台执行仍依赖随附的 Node 与 pnpm 边界；可执行文件缺失、锁文件损坏或权限失败会带修复诊断停止启动，而不会允许混合运行时继续运行。
