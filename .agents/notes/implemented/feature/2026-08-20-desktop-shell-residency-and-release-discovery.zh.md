# Agent Note: 桌面宿主驻留与 Release 发现

Status: implemented

[English](2026-08-20-desktop-shell-residency-and-release-discovery.md) | 中文

## Problem

打包桌面宿主会随唯一窗口退出，无法登录启动，也没有原生生命周期通知；只有 Harness 耗尽启动重试后才会显示诊断入口。现有更新器面向受信任源码 checkout，而非打包 Release，因此用户也看不到应用版本更新信号。

## Decision

Electron 主进程拥有 `userData` 下的一份持久偏好文件、一套串行应用生命周期和一个系统托盘。默认关闭窗口只隐藏窗口，显式退出则等待 Harness 关闭。用户可通过受限 preload bridge 切换关闭行为、原生生命周期通知和已打包 macOS 的登录启动；不支持的平台把登录启动报告为不可用。

连接页等待十五秒后显示固定 Harness 日志入口，但不会把缓慢启动判为失败。主进程只定位这份已知文件或其父目录，不接受渲染进程提供的路径。重启、连续失败与恢复通知采用操作系统语言，并按事件种类节流。

打包应用查询 `flaqai/open-deepseek-harness-desktop` Releases，只向浏览器端暴露规范化状态和经过仓库校验的 Release URL。预发布客户端跟随当前预发布通道，也可迁移到更高的稳定版；稳定版忽略预发布。客户端 UI 只链接 Release 页面，不下载、安装或替换应用文件。源码运行继续使用独立的受信任 checkout 更新器。

## Alternatives considered

**静默自动更新。** 未签名 Windows 产物和 ad-hoc 签名、未公证的 macOS 产物不具备无人值守替换所需的签名与回退保证，因此应用只打开选定 Release 页面。

**把桌面偏好存入 Harness settings。** 关闭和登录启动行为必须在 Web 客户端连接前可用，因此 Electron 持有一份小型独立文件，只暴露类型化偏好操作。

**默认关闭即退出。** 这会意外停止后台任务和受监管 Harness。托盘驻留为默认行为，同时持久偏好保留明确的关闭即退选择。

## Consequences

桌面进程可以在没有可见窗口时保持活动，因此每条显式退出路径都必须汇入同一套异步 Harness 清理。原生托盘文案跟随操作系统语言，而非 Web 语言。登录启动刻意只支持 macOS。Release 发布可以提供稳定产物名和校验和，但在具备签名发行与回退前，应用替换仍是用户手动操作。
