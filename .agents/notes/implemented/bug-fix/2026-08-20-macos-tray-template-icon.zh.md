# Agent Note: 为 macOS 托盘提供专用模板图标

Status: implemented

[English](2026-08-20-macos-tray-template-icon.md) | 中文

## 问题

桌面宿主把完整的 1024 像素应用图标缩小后标记为 macOS 模板图。由于圆角方形背景并不透明，macOS 会把整个方块转换成单一的菜单栏颜色，最终显示成纯白按钮，而不是应用标志。

## 决策

macOS 改用根据“骑鲸”轮廓绘制的黑色加透明通道 `tray-iconTemplate.png`。源 SVG 让小尺寸几何可以维护，16 像素 PNG 与 32 像素 `@2x` PNG 遵循 Electron 的模板图命名与密度约定。Windows 和 Linux 继续使用完整的彩色应用图标。

## 验证

桌面资源构建会复制两个密度的模板 PNG，且不会改名。基础资源为 16×16 RGBA，Retina 资源为 32×32 RGBA，两者都保留透明背景。桌面类型检查与桌面构建验证消费路径。

## 后果

菜单栏图标会适配系统明暗外观，并在原生状态栏尺寸下保持可辨识。应用窗口、系统通知、安装包与 Dock 仍使用现有彩色图标。
