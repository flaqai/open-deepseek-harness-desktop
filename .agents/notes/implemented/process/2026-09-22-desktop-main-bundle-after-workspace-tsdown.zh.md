# Agent Note：在工作区库构建后再构建社区 Desktop

Status: implemented

[English](2026-09-22-desktop-main-bundle-after-workspace-tsdown.md) | 中文

## 问题

官方 Desktop 的主进程用 tsdown 打包工作区导入。该 bundle 与其他工作区包并发构建时，全新检出目录可能因为依赖包的 `lib/` 入口尚未生成，在 `app.asar/lib/main.js` 中留下无法解析的导入。社区 Desktop 使用另一套打包结构：TypeScript 将主进程模块输出为 ESM，安装版携带这些模块声明的生产依赖。只针对官方主进程 bundle 的导入检查无法验证社区结构。

## 决策

`build:community-desktop` 先完成原生扩展、Host 库、Client 库与 Web 资源，再运行 `build:desktop`。Desktop 构建随后将 `apps/desktop/src` 编译到 `lib/`，仅通过 [`tsdown.preload.config.ts`](../../../../apps/desktop/tsdown.preload.config.ts) 打包沙箱 preload 入口，并复制 Desktop 资源。根工作区的两次 tsdown 构建都不包含 `apps/desktop`。

Electron 主进程不是独立的 tsdown bundle。其运行时导入必须由 Desktop 生产依赖和已打包的 Harness 依赖闭包解析；[Windows 解包探针](../../../../apps/desktop/scripts/smoke-windows-unpacked.mjs)检查安装版入口与关键包。Desktop 包及部署检查覆盖已声明的生产依赖集合。社区构建没有 `desktop-bundle-imports` 插件。

## 备选方案

**在 Host tsdown 后打包社区主进程。** 这需要为社区入口及其安装包依赖布局另设导入策略，也会与 Harness 运行时中的模块重复。目前的 ESM 入口及生产依赖检查只需验证一套打包依赖闭包。

**将 Desktop 纳入根工作区 tsdown 阶段。** 该阶段并发构建成员，无法保证 Desktop 排在它所需的库之后。将 Desktop 留在社区构建的最后一步，能明确其前置条件。

## 后果

全新社区检出目录必须先完成工作区库构建，再编译 Desktop。打包流程验证主进程入口及其加载的生产依赖，不依赖官方主进程 bundle 检查。普通根 `build` 不生成 Desktop 产物；`build:community-desktop` 增加最后的 Desktop 步骤。安装版运行时布局由 [Desktop 打包指南](../../../../apps/desktop/README.zh.md) 负责说明。
