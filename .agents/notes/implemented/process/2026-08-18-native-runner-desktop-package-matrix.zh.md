# Agent Note: 原生运行器桌面发行包矩阵

Status: implemented

[English](2026-08-18-native-runner-desktop-package-matrix.md) | 中文

## Problem

桌面应用依赖平台专属的 Node 软件包与原生二进制文件。在其他操作系统或 CPU 上组装出的软件包即使拥有完整 Electron 文件，也可能携带无法在用户设备上加载的 Harness 运行时。原有桌面脚本仅准备 macOS arm64 运行时与未签名的 Windows x64 ZIP，因此仅在一台主机上增加目标参数无法生成项目列出的五种发行产物。

## Decision

`.github/workflows/desktop-packages.yml` 在匹配的 GitHub 原生运行器上构建每种产物。macOS arm64 与 x64 分别生成 ad-hoc 签名的 DMG 和更新 ZIP，Windows x64 生成 NSIS 安装程序，Linux x64 生成 DEB 与 RPM 软件包。工作流将各安装包作为独立产物上传，并在一个 `SHA256SUMS` 产物中记录其 SHA-256 值；它不会创建或发布 GitHub Release。

`apps/desktop/scripts/prepare-unix-runtime.mjs` 接收与 Codex 组合包和 electron-builder 调用相同的显式 darwin-arm64、darwin-x64 或 linux-x64 目标。脚本下载对应的固定 Node 24.11.1 压缩包并核对官方 SHA-256 值，部署生产 Harness 依赖闭包，验证目标平台的 Koffi、Sharp 与 require-builtin 原生包，嵌入 pnpm 11.7.0，并写入目标专属的运行时压缩包。桌面与 Web 的包脚本从各自应用目录直接运行，而不是通过仓库 workspace 选择目标，因此平台专属 workspace 包不会参与无关应用的命令发现。打包后的 macOS 与 Linux 应用会把该压缩包解压到带版本号的用户数据目录，并使用其中的 Node 与 pnpm 启动 Harness。

Windows 保留独立的无符号链接运行时闭包，因为 Electron 会提供兼容 Node 的可执行文件。安装后的应用会在该可执行文件旁生成 pnpm 启动器，并通过 `NODE_PATH` 暴露中性的 `runtime-dependencies` 目录。

Windows NSIS 配置不设置 `useZip`，因此 electron-builder 使用默认的 7z/LZMA 载荷。原生冒烟测试会先把该载荷安装到包含空格和中文的路径，再启动应用。ZIP 载荷试验在 15 分钟期限内没有生成已安装的可执行文件或 Harness 文件，而默认载荷能够完成安装并使 Harness 就绪。

内置插件准备流程会把生成的归档从 Runner 临时目录复制到 checkout 的产物目录。Windows Runner 可能把这两个目录放在不同卷上，此时 `rename` 会以 `EXDEV` 失败；外层的临时目录清理负责删除源文件副本。

TypeScript 桌面构建会为主进程生成 ES 模块，但 Electron 的沙箱 preload 加载器要求 CommonJS。因此，专用的 tsdown 步骤会把 preload 及其本地窗口边框辅助代码打包为 `lib/preload.cjs`，同时将 `electron` 保留为运行时 `require`；BrowserWindow 加载该 `.cjs` 产物。

发行文件名不包含软件包版本，使 `releases/latest/download` URL 保持稳定：`DeepSeek-Harness-macos-{arm64,x64}.dmg`、`DeepSeek-Harness-windows-x64.exe`、`DeepSeek-Harness-linux-x64.{deb,rpm}` 与 `SHA256SUMS`。每个软件包都包含可卸载的首次运行插件市场种子。

## Alternatives considered

**从一台 macOS 主机交叉构建全部产物。** Electron 可以组装部分其他平台的外壳，但 pnpm 会为当前主机安装原生可选依赖。外观属于其他平台的产物无法证明其中的 Harness 运行时能够加载。

**在所有平台都把 Electron 用作 Node 载体。** 这种方式适用于 Windows 依赖闭包，但 Unix 软件包需要普通 Node 与 pnpm 工具链来执行插件生命周期脚本。嵌入固定的上游 Node 压缩包，可让这些脚本与 Harness 使用相同运行时。

**从构建工作流直接发布 Release。** 第一版矩阵需要在没有写权限且不会意外公开发布的情况下取得原生打包证据。工作流保留可下载的 Actions 产物；完成验证后再通过独立且明确的操作发布 Release。

**直接加载 TypeScript 生成的 `preload.js`。** 桌面包属于 ES 模块包，因此 TypeScript 会生成基于 `import` 的 preload。Electron 的沙箱 preload 加载器会把该文件当作 CommonJS，并在桥接代码安装前拒绝加载。

**在 NSIS 安装器内部使用 ZIP 压缩。** ZIP 可能降低解压 CPU 开销，但经过验证的 Windows Runner 无法在 15 分钟内完成该运行时的解压。默认 7z/LZMA 载荷保留了原生安装与启动冒烟测试已经证明可用的安装路径。

**使用 `rename` 移动生成的插件归档。** 重命名在单个文件系统内具有原子性，但 Windows Runner 的临时目录和 checkout 可能位于不同卷。复制到产物目录能够跨卷工作，现有临时目录清理会删除源文件。

## Consequences

发行包矩阵会占用四个原生任务，无法在一台开发者设备上完整复现。任务成功可以证明对应的原生依赖闭包与安装包格式已完成组装，但产品支持仍需验证各平台的生命周期、PTY、文件系统、沙箱、安装和首次启动行为。固定文件名可让后续最新版链接保持稳定，但每次 Release 的同一平台与架构只能容纳一个同名产物。Windows 打包优先采用已验证的 7z/LZMA 安装路径，而不是 ZIP 载荷的解压特性。
