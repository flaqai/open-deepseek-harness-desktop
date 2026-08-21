# Agent Note: 基于 rc.8 客户端架构的社区桌面版集成

Status: implemented

[English](2026-08-20-community-desktop-rc8-integration.md) | 中文

## Problem

社区桌面发行版在上游 Web 产物之外还包含设置、首次向导、主题、背景、预设插件、运行时隔离和打包行为。上游 rc.8 引入了动态客户端包、构建环境记录、通用品牌插槽、共享设置 schema 操作、附件与引用，以及默认打开浏览器的 Web 启动器。继续复制旧基础组件会绕过这些约定；从没有 Profile 的客户端构建 Electron 包，则可能混入官方与社区行为，或打入陈旧浏览器产物。

## Decision

仓库通过 merge 保留上游历史，并把 rc.8 作为架构基线。完整的 `community-desktop` 客户端构建 Profile 会在构建 Electron 主进程之前，同时向 Vite 和动态客户端 bundle 提供 Git 短 revision、现有应用标题，以及 `DSH_CLIENT_BUILD_PROFILE=community-desktop`。上游通用壳保持不变。独立的社区品牌包只在该 Profile 下占用侧边栏与 Hero 品牌插槽；官方品牌包仍仅限 `official` 构建。

Electron 应用、桌面设置包和社区品牌包仍是私有工作区成员。安装包构建会消费它们，但官方 `dsh` npm 发布 family 会排除它们，因此不会通过改写仓库 identity 来暗示 DeepSeek 发布了该社区发行版。

Electron 使用 `web --host 127.0.0.1 --port 0 --no-open` 启动内置 Harness，因此本地 Web 界面只由经过加固的嵌入窗口承载。桌面版本跟随 rc.8 基线，同时应用 identity、数据路径、运行时 staging、内置 pnpm、预设插件 seed、主题、背景、首次向导和桌面设置仍是社区扩展。模型设置与首次向导共享 rc.8 的设置 schema 操作和 mirror，不再维护第二条写入路径。

配置目录、客户端 slot catalog、双语配对记录和工作区锁文件都从合并后的源码重建。接受上游 schema 17 及其公共请求行为，不增加私有 SQLite 迁移或协议兼容层。

## Alternatives considered

**只挑选 rc.8 的部分功能。** 这会让客户端包图、设置 mirror、生成目录和运行时依赖闭包停留在互不兼容的代际，也会使后续上游合并更困难。

**让桌面包使用官方构建 Profile。** 这会错误标识社区发行版，并让仅供官方使用的 occupant 进入社区产物约定。

**继续直接修改上游壳组件。** 通用插槽已经提供有所有权的扩展边界；直接修改会重新制造持续性合并冲突，并把社区品牌耦合到会话和侧边栏包。

**允许 rc.8 Web 启动器打开浏览器。** Electron 已经渲染回环地址。额外浏览器界面会造成意外、重复启动界面，而且桌面产品不需要它。

## Consequences

社区桌面构建现在与上游产物一样拥有带记录且由摘要绑定的客户端环境，同时官方与社区品牌会按 Profile 保持互斥。设置和首次向导遵循同一条 schema／mirror 路径；rc.8 的附件、引用、持久 PowerShell、子 Agent 等新包进入正常工作区与 staging 依赖闭包。

发行版必须先运行完整社区客户端构建，再编译桌面端；局部客户端构建会按设计使产物摘要失效。Windows 安装烟雾测试仍必须在 Windows runner 上执行，因为 Node、pnpm、NSIS 安装、带空格或中文的路径和预设插件 seed 都需要在最终平台布局中验证。本地构建成功并不授权 merge、发布或 Release 操作。
