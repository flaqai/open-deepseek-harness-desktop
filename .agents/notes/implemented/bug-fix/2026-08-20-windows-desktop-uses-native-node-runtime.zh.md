# Agent Note: Windows 桌面安装包使用原生 Node 运行时

Status: implemented

[English](2026-08-20-windows-desktop-uses-native-node-runtime.md) | 中文

## 问题

Windows 桌面安装包会重命名 Harness 生产运行时的 `node_modules` 目录，并通过 Electron 的 Node 兼容模式和 `NODE_PATH` 启动 ESM CLI。Node ESM 解析不会使用这套 CommonJS 查找机制，为普通 Node 构建的原生包也不保证与 Electron 的 Node ABI 匹配。因此 Electron 窗口能够打开，但受监管的 Harness 进程可能在就绪前反复退出。

## 决策

Windows x64 安装包在 `resources/runtime/win32-x64` 中携带官方 Node 24.11.1，在 `resources/harness` 中携带保留真实 `node_modules` 层级的 Harness 部署闭包。准备脚本只接受固定的官方归档哈希，将部署链接实体化，递归注入旧版 deploy 遗漏的已声明工作区依赖，删除非目标平台原生包，通过调用内置 Node 的命令包装器提供 pnpm 11.7.0，验证必需的 Windows 模块，并在打包前通过这套准确运行时启动 Harness。Electron Builder 26 通过独立的资源映射接收闭包顶层的 `node_modules`，因为它的通用目录复制器会有意忽略名称为 `node_modules` 的源根目录。

Electron 宿主使用内置 `node.exe` 启动 `resources/harness/lib/bin.js`，通过 `DSH_PNPM_BIN` 传入内置 pnpm，并把运行时目录放到插件生命周期脚本 `PATH` 的开头。宿主不会设置 `ELECTRON_RUN_AS_NODE`、`NODE_PATH` 或 Electron 专属 Node 参数。

子进程在就绪前连续退出三次会进入终止性的启动失败状态。加载页会显示有界的失败信息和日志位置，并提供明确的重试与打开日志目录操作。

## 验证

桌面单元测试固定原生 Node 启动参数、内置包管理器环境、三次失败上限和明确重试。运行时准备会实际执行内置 Node、pnpm 和 Harness 就绪路径。Windows 工作流会等待最终 NSIS 进程结束并检查退出码，把产物安装到包含空格和中文字符的路径，验证已安装资源布局，并要求已安装应用在上传产物前进入 Harness 就绪状态。

## 考虑过的替代方案

**继续让 Electron 承载 Node 并修补 `NODE_PATH`。** 被拒绝，因为 ESM 包解析和原生模块兼容性仍依赖独立 CLI 不使用的行为。

**归档 Windows 运行时并在首次启动时解压。** 被拒绝，因为直接资源布局不需要首次启动解压器，能匹配成熟的 Windows 打包模式，同时保留真实 `node_modules` 目录。

**要求用户安装 Node 和 pnpm。** 被拒绝，因为桌面启动和插件管理不应依赖 shell 配置或系统工具版本。

## 后果

Windows 安装包会因包含官方 Node 发行版和未改名的依赖闭包而增大。作为回报，应用启动与插件生命周期命令采用和 CLI 相同的 Node 语义，打包时及安装后的烟雾测试会拒绝损坏的布局，持续启动失败也会变得可诊断，而不是无限循环。
