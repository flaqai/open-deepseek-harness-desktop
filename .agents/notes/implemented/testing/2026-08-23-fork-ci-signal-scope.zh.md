# Agent Note: Fork CI 信号范围

Status: implemented

[English](2026-08-23-fork-ci-signal-scope.md) | 中文

## Problem

这个桌面端 fork 不保存 DeepSeek API key，也不发布上游 npm 包族，但继承的工作流把这两项操作都当作自动仓库检查。于是每次主分支更新都会产生与桌面产物无关的失败：真实 API 工作流因缺少 secret 而在测试前失败，npm 发布演练则尝试从公共 registry 解析 fork 私有的 Web 包。macOS Sandbox job 还会在纯文档修改时运行完整单元套件，其中两个 PowerShell 集成测试文件与数百项并行测试争用资源，返回受时序影响的终端输出。Windows 桌面打包使用不带命令 shell 的 `spawn()` 调用 `.cmd` launcher，导致内置 Codex 插件尚未准备便以 `EINVAL` 失败。

## Decision

仓库 Actions 保持 keyless。本 fork 不设置真实 DeepSeek API 工作流；`pnpm run test:e2e` 保留为显式本地检查，并在缺少凭证时自动跳过。上游 `Release (dsh)` npm 演练只通过 `workflow_dispatch` 运行，桌面安装包则继续通过原生 runner 打包矩阵从 `dsh-v*` tag 构建。

Sandbox 工作流忽略只修改 Markdown、Agent Note、文档站和 website 的 push。其 macOS parity 步骤从仓库并行测试中排除两个 PowerShell 真实 shell 文件，再以单 worker 一起运行这两个文件。这样既保留真实 shell 覆盖，也避免仓库级 worker 争用改变提示符检测结果或让断言依赖的终端 scrollback 溢出。

内置 Codex 准备脚本只对 Windows `.cmd` 与 `.bat` launcher 使用命令 shell。原生可执行文件仍不经过 shell，launcher 参数仍由已校验的包目标和私有临时路径在内部构造。

## Alternatives considered

**配置仓库 API secret。** 本 fork 不需要自动调用付费 provider；加入 secret 会扩大凭证暴露面，同时让外部服务可用性继续产生与桌面正确性无关的通知。

**每次 push 都运行 npm 发布演练。** fork 私有品牌包不是上游公共 npm 包，因此自动检查上游包族发布并不代表本仓库的发布路径；维护者处理该包族时仍可手动启动演练。

**在 macOS 跳过 PowerShell 集成测试。** 这会丢失持久 PowerShell 状态和 UTF-8 终端输出仅有的 macOS 原生证据。单 worker 执行既保留证据，也消除已经观察到的跨文件争用。

**让所有 Windows 子进程都经过 shell。** 原生可执行文件不需要 shell；这么做会无谓扩大解析和引号行为。只有 Windows 命令脚本 launcher 需要由 `cmd.exe` 中介。

## Consequences

日常 push 只产生与本 fork 所交付代码相关的 keyless 信号，纯文档修改也不再占用原生 Sandbox 矩阵。线上 DeepSeek 兼容性不再是托管合并或每夜信号；修改 provider 行为时，维护者必须携带显式 key 运行本地套件。上游 npm 发布漂移只会在手动启动对应工作流时被发现。Windows 包正确性仍由原生 Windows Actions job 验证；聚焦的 macOS PowerShell 检查会比并行执行耗时更长，但能提供稳定的平台信号。
