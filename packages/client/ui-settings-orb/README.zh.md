---
description: "社区桌面客户端的独立悬浮球设置页。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-orb

[English](README.md) | 中文

## 概述

「悬浮球」页面管理显示、启动、划词、头像与屏幕边缘位置偏好。它先读取桌面端的功能可用性、系统权限和任务状态，再提供本机操作。本机设置按 `DSH_HOME` 分开保存；NAS 聊天外观按已配对服务器独立保存，不能改变远程能力。

## 目录

- [使用此包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

社区桌面连接本机数据目录或已配对 NAS 后，打开「设置 → 悬浮球」。默认导航中，该页面位于「工具与能力」后；已有的自定义导航顺序保留其他项目，仅在工具页附近插入新页面。本机模式可跳回「工具与能力」安装官方 Computer Use 驱动。

-----

<a id="understand-the-implementation"></a>
## 实现说明

插件贡献一个 `settings.section` 插槽，并订阅桌面进程拥有的设置。渲染进程只通过 `DesktopOrbBridge` 提交封闭的设置补丁，不能提供任意路径、网址、包名或命令。NAS 模式下桥接接口只接受聊天外观修改，不暴露后端切换，并拒绝本机划词设置。本机模式下，任务状态未知时不能切换后端；切换成功后，页面提供已有的快速重启操作。

本包不发布运行时不变量伴随文件，因为 Desktop 桥接接口在接受每次设置修改前都会验证功能和权限状态；此页面只呈现 Host 返回的结果。

在本机模式启用复制后快捷键后，先复制文字，再按 Cmd/Ctrl+Shift+O。用户可明确选择「发给悬浮聊天」「译中」「译英」或「搜索」。支持定位的平台会在指针附近显示工具栏；原生 Wayland 无法定位跨应用工具栏，改用原生选择框。取消不会修改草稿，任何选项都不会自动发送聊天消息。NAS 模式或本机任务、输入权限不可用时，划词操作也不可用。

<a id="model-experience"></a>
## 模型体验

无；此页面只修改桌面界面的状态，不向模型发送内容。

#### KV Cache 影响

无；此包不组装模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 只有 Host 对应方法报告可用时，页面才开放划词、后端切换与后台状态。页面不授予系统权限，也不批准后台命令。
- 普通 Web 页面没有桌面桥接接口。NAS 模式仅在连接验证成功后显示远程聊天；本机 Computer Use、划词及后台任务控件保持不可用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

将高权限窗口和 Profile 更改留在桌面主进程。界面更新成功应对应已持久化的 Host 状态，写入失败时应回退。

</details>
