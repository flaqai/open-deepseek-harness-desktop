---
description: "Electron 专用的桌面偏好、命令行注册与 Release 发现客户端设置。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-desktop-shell

[English](README.md) | 中文

## 概述

本包向“通用设置”贡献 Electron 专用的关闭行为、原生通知、登录启动、受管 `dsh` 命令行入口和 Release 发现设置行。普通 `dsh web` 浏览器不会收到任何贡献。

## 目录

- [使用方式](#use-this-package)
- [安全边界](#understand-the-security-boundary)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用方式

将本包挂载到桌面客户端 Bundle。它只在窄权限的 `window.deepSeekHarnessDesktop` 预加载桥存在时激活，并严格反映 Electron 主进程报告的能力。

原生应用菜单导航使用现有工作区和设置服务。“新对话”保留这些服务原有的草稿行为；通用设置消费一次性的更新区域或数据目录选择请求。插件设置项缺失时报告错误，不安装任何内容。连接与语言订阅发布当前菜单就绪状态，并随插件释放。平台行为见[应用菜单](../../../apps/desktop/README.zh.md#application-menus)。

Release 发现会把同一份状态投影到通用设置、设置面板标题栏，以及紧邻侧栏“设置”的蓝色操作按钮。只有存在更新时才显示两处更新操作；点击任意一处都会打开通用设置的更新行。源码构建中的开发更新模拟也使用同一投影。

Windows 与 macOS 的“应用图标”提供本地图片选择、支持键盘操作的方形裁剪、缩放、预览及独立托盘偏好。取消不会保存。卡片按目标位置显示结果及图片缺失提示；Windows 还提供明确的快捷方式创建与更新重试控件。平台限制与存储归属见[桌面图标说明](../../../apps/desktop/README.zh.md#custom-application-icons)。

-----

<a id="understand-the-security-boundary"></a>
## 安全边界

所有高权限操作都由预加载桥持有。本包只接收规范化状态并请求白名单操作；它不能读取任意文件、运行任意命令、选择任意外部 URL 或替换应用运行时。

裁剪界面只提交绑定渲染窗口的选择 ID、固定用途及有界的方形坐标。Electron 会在原子持久化前校验并裁剪图片，浏览器预览像素不具有最终决定权。关闭编辑器会释放临时图片。图标变更不会调用 Harness 或改写插件配置。

本包不发布 invariant companion，因为生命周期 effect 和预加载能力边界已经承担本包的运行时检查。

<a id="model-experience"></a>
## 模型体验

无，因为本插件只改变桌面界面与应用偏好，不增加会话事件、模型上下文、工具或模型可见输出。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 平台能力存在差异：登录启动和 Shell Profile 集成由桌面宿主报告，浏览器层不作假设。
- Release 安装仍由宿主控制并要求已验证的产物；客户端包本身不执行安装程序。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

保持 IPC 窄权限且基于能力。渲染层 props 不得接受任意文件系统路径、命令或 URL。

</details>
