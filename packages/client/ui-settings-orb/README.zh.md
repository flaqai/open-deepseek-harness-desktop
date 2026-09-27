---
description: "社区桌面客户端的独立悬浮球设置页。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-orb

[English](README.md) | 中文

## 概述

「悬浮球」页面管理社区桌面的显示、启动、头像与屏幕边缘位置偏好。它只通过受限的桌面悬浮球接口读写设置。设置按 `DSH_HOME` 分开保存；页面不能改变 NAS 主机或普通 Web 客户端。

## 目录

- [使用此包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

以本机数据目录启动社区桌面后，打开「设置 → 悬浮球」。默认导航中，该页面位于「工具与能力」后；已有的自定义导航顺序保留其他项目，仅在工具页附近插入新页面。页面可跳回「工具与能力」安装官方 Computer Use 驱动。

-----

<a id="understand-the-implementation"></a>
## 实现说明

插件贡献一个 `settings.section` 插槽，并订阅 Host 拥有的状态快照。渲染进程只通过 `DesktopOrbBridge` 提交封闭的设置补丁，不能提供任意路径、网址、包名或命令。Host 会拒绝非法参数及 NAS 环境中的请求。

<a id="model-experience"></a>
## 模型体验

无；此页面只修改桌面界面的状态，不向模型发送内容。

#### KV Cache 影响

无；此包不组装模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 划词捕获、Computer Use 后端切换与后台任务控件，需完成受保护的 Host 集成后才能启用。对应卡片解释预期边界，不宣称功能已经可用。
- Web 和 NAS 页面只展示不可用状态，不创建本机悬浮窗。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

将高权限窗口和 Profile 更改留在桌面主进程。界面更新成功应对应已持久化的 Host 状态，写入失败时应回退。

</details>
