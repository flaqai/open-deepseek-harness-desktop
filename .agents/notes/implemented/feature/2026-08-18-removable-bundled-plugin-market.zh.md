# Agent Note：可卸载的内置预设插件

状态：已实现

[English](2026-08-18-removable-bundled-plugin-market.md) | 中文

## 问题

桌面安装包应离线提供选定的 Web 插件，同时让每个插件保持为用户可卸载、后续可更新的普通 profile 依赖。体积较大或面向特定产品的集成不应延迟启动，也不应在用户没有明确操作时安装。若写入核心 Cordis bundle，启动会恢复已移除插件；若把所有内置归档装成 `file:` 依赖，更新工具又无法识别 registry 身份。

## 决策

Electron 资源携带固定 tarball 及其 SHA-512 完整性，分别对应 `dshmarket@1.19.0`、`@xmanrui/dsh-im@1.0.2`、`dsh-skill-picker@0.2.0`、`dsh-font@1.1.0`、`dsh-pocket@1.12.3` 和 `dsh-better-sidebar@0.15.2`。目标平台打包步骤还会加入官方 `@deepseek-ai/dsh-subagent-codex@0.1.0-rc.8`、`@openai/codex@0.147.0` 和一个原生 payload。清单 schema 2 将每个条目标为 `startup` 或 `manual`，并可提供精确 registry 版本或固定 Git 提交。

打包应用启动时仅按清单顺序处理五个启动条目。它使用安装包内 Node 与 pnpm，优先安装精确 registry 或 Git 身份，让普通插件更新工具能够识别依赖；网络或 registry 不可用时，才回退到经过校验的本地归档。安装成功或发现已有同名依赖后，会写入该插件的持久种子标记，且不会替换已经安装的版本。单个条目失败会写入诊断，但不会阻止其余启动条目继续播种。运行时准备会把同一组启动条目安装到一次性 profile；手动条目只保留并校验完整性，不会在用户明确请求安装前执行其可选生命周期代码。

Better Sidebar 在清单中仍属于 manual 条目，但延后到主界面可用后处理：右下角浮层非阻塞地展示完整性校验、解压和配置。隐藏不会取消任务；成功或失败会再次出现，并只提供应用重启或固定日志等窄能力。持久标记会在此前安装或卸载后抑制自动延后任务，而既有发现页的明确安装操作仍可覆盖该 tombstone。Codex 仍仅由“外部工具”手动安装。渲染进程不会获得通用安装器：沙箱 preload 只转发清单中 manual 条目的精确 profile 与 package spec 组合，其余安装请求继续经过受保护的 Host Remote。同一目标最多只有一个活动包管理写入进程，轮询任务保留有界诊断。

每个标记都会在 profile 移除后保留，因此后续启动不会自动重装对应插件。Windows 安装包使用官方 Node 可执行文件和参数数组运行内置 `pnpm.mjs`，不经过 shell 插值。Host 提供精确包名移除能力；启动和手动条目仍都是普通依赖，可以通过标准 profile 插件管理器移除。

## 考虑过的替代方案

- **核心 Web bundle：** 拒绝，因为无法独立卸载。
- **缺失就重新预装：** 拒绝，因为会撤销用户卸载。
- **在 Harness 启动前安装全部内置归档：** 拒绝，因为 Better Sidebar 会拖慢首次进入，而 Codex 必须继续由用户触发。Better Sidebar 改为主界面可用后再启动。
- **始终使用本地归档安装：** 拒绝，因为 `file:` 身份会阻止插件市场把社区预设识别为普通、可更新的 registry 或 Git 依赖。
- **本地安装后重写 lockfile：** 拒绝，因为离线环境不保证 registry 元数据，手工修改 lockfile 也会绕过 pnpm 的解析契约。
- **插件自卸载：** 拒绝，因为插件无法可靠移除自身正在活动的软件包和 bundle。
- **Windows 系统 Node 与 pnpm：** 拒绝，因为安装包必须自包含。

## 影响

macOS、Windows 与 Linux 安装包携带六个经过审计的社区归档，以及一个目标平台专用 Codex 归档。首次启动时，每个缺失的启动种子都可能运行一次包管理操作，并可能先访问 registry 再使用离线回退。Better Sidebar 只在主界面可用后消耗 profile 安装时间；Codex 在用户请求前不消耗安装时间。测试固定完整策略清单、归档完整性、已有版本接管、卸载标记抑制、任务单写入、阶段进度、有界诊断和渲染进程回退。已安装 Windows 烟雾测试仍要求五个启动依赖在上传前就绪；Better Sidebar 属于进入后的行为，Codex 在用户操作前必须保持未安装。
