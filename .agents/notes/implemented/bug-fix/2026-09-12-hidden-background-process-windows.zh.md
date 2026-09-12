# Agent Note: Windows 后台进程隐藏窗口

Status: implemented

[English](2026-09-12-hidden-background-process-windows.md) | 中文

## Problem

若干一方进程启动路径在终端中工作正常，但由 Windows 安装版桌面应用触发时可能创建可见的命令行窗口。SDK 运行时启动器、Profile 包管理器的探测与安装，以及独立 Web 模式的浏览器辅助进程都没有显式要求隐藏窗口。

## Decision

这些路径中的每个一方后台启动点都显式设置 Node 的 `windowsHide` 选项。标准输入输出、错误、退出处理、超时和进程所有权保持不变。测试固定各启动边界的该选项，防止后续重构静默重新引入闪窗。

## Alternatives considered

**只隐藏桌面模块直接拥有的子进程。** SDK 和 CLI 路径同样可能由桌面应用调用，因此只保护 `apps/desktop` 会遗漏间接启动。

**使用 detached 或 Shell 专用启动器。** 分离进程会改变生命周期所有权，Shell 包装器还会增加转义和进程树风险。`windowsHide` 可以在不改变执行语义的情况下解决显示缺陷。

## Consequences

Windows 安装版用户不会再因这些后台操作看到短暂的命令行窗口。终端调用仍收集相同输出，非 Windows 平台会忽略该选项。实验性运行时和第三方插件进程不属于本次决策，修改前仍需单独审查所有权。
