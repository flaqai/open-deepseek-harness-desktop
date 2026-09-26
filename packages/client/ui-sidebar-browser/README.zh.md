---
description: "右侧 Sidebar 浏览器 tab：在 sandbox 中访问 HTTP(S) 页面，包括 loopback 服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-browser

[English](README.md) | 中文

## 概述

在独立的右侧 Sidebar tab 中浏览 HTTP(S) 页面，包括 loopback 服务。Web 和社区 Desktop 都使用 iframe，由应用维护 history。本包不会向被访问内容注入 Electron 或 Node 能力。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Browser 在 Web profile 中默认禁用，在 Desktop 中默认启用。Web 用户可通过 profile patch 启用随附条目。可以从右侧 Sidebar guide 打开 **浏览器**并输入 HTTP(S) URL。Chat 的[链接偏好](../ui-chat/README.zh.md)选择**应用内侧边栏**时，HTTP(S) 链接会在此打开。不带 scheme 的主机名会补全为 HTTPS。公共目标与 loopback 目标使用相同的默认 sandbox。每次 guide 操作或委托到此的消息链接操作都会创建一个新的 Browser tab。

### 何时选择

当 Web 页面需要保留在当前 Session 旁时，选择 Browser。本地文件使用 [Document Preview](../ui-sidebar-documentpreview/README.zh.md)；站点拒绝 iframe 嵌入或需要本包不授予的浏览器 capability 时，使用明确的外部浏览器操作。

### 最小配置

本包没有插件配置字段。Web profile 通过其 profile patch 启用随附条目：

```yaml
- id: ui-sidebar-browser
  disabled: false
```

Client 插件可以调用 `ctx.sidebarRight.openTab('browser', { params: { url } })` 打开 tab。可选 URL 会在导航前接受与地址栏输入相同的校验。

命令 `browser.new` 在焦点停靠分栏打开独立浏览器页，替换开始页并保留已有内容页。从聊天区或浮动内容页触发时，使用活动停靠分栏。桌面默认键在 macOS 上为 Cmd+T，在 Windows 上为 Ctrl+T；Windows 和 macOS Web 使用[快捷键服务的平台默认值](../shortcuts/README.zh.md)；Linux Web 默认不绑定此命令。开始页按钮使用蓝色地球图标，并在按钮内显示有效快捷键，不额外弹出重复提示。

工具栏提供后退、前进、刷新、前往和在系统浏览器中打开。Web 提供带警告的逐 tab 临时 sandbox 开关；社区 Desktop 固定启用 iframe sandbox，并隐藏开关。tab 标题取自应用最后已知的地址，而不是无法读取的跨域页面标题。重启后，Browser 展示保存的标题和 URL；只有点击恢复或刷新才打开该地址。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——点击展开</summary>

### 协议策略

地址解析器接受 HTTP 与 HTTPS，包括 loopback 目标。`file:` URL、脚本/data/blob 输入、内嵌凭据、DSH 应用自身 origin 和畸形地址会被拒绝。本地文件由 Document Preview 负责渲染。

### Iframe 载体

Web 默认使用 `sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"`，并提供逐 tab 临时开关。逃逸的 Web popup 会保留 opener，并可以导航应用；关闭 sandbox 后，Web 页面还能使用下载、对话框与输入锁定。社区 Desktop 将 iframe 固定为 `sandbox="allow-scripts allow-forms allow-same-origin"`：嵌入页不能创建 popup、直接下载、导航顶层应用或关闭 sandbox。Electron 主进程拒绝子框架请求当前 Harness 监听地址，包括 loopback 别名；只有 referrer 属于 Harness origin 且没有 POST body 的普通 HTTPS popup 才会在系统浏览器中打开。工具栏的外部浏览器操作通过仅接受主框架请求的 HTTP(S) bridge 交给主进程。两种载体的 iframe 都不发送 referrer，也不添加包自有的 Permissions Policy；被访问的 origin 可以在父浏览器 session 中使用自身 Cookie 与 Web storage。本包不代理或探测远程页面。

iframe 提供方记录 toolbar 提交和 typed tab 打开。导航状态机把每个受控 revision 的第一次 iframe load 视为已知，把后续 load 视为页面已经变化到不可读取 URL 的证据。进入 unknown 状态后，地址会显示标记，后退、前进和外部打开会禁用，刷新则返回最后一个受控 URL。body 重挂载时会重新加载应用最后已知的 URL，并且仅在尚无受控目标时使用可选初始 URL。不产生 iframe load 的 History API 与 fragment 变化仍不可见。iframe `error` event 会显示临时加载失败 notice，直到下一个受控加载，但不会改变 URL history。

### Controller

每个 tab 的 `BrowserController` 负责地址校验、命令和显式恢复。`BrowserFrame` 提供与载体无关的导航状态；`IframeImpl` 使用 `BrowserNavigation`，`ElectronWebViewImpl` 观察 Chromium history。`BrowserPresentation` 负责 DOM 的物理挂载。Slot injection 提供 `useBrowserState` 和普通 callback，React body 不接收 provider 对象或 observable。

只有 Desktop preload 暴露 `dshDesktop.browser` 时才会选择 `ElectronWebViewImpl`；社区 Desktop preload 未暴露这个 bridge，因此会选择 `IframeImpl`，也不会请求 `keepMounted`。未接线的 WebView 路径需要主进程 bridge 发放 guest 租约并约束导航和权限，之后才能在 Sidebar 切换时保留 guest DOM。这些 guest 保护与保留规则都不适用于社区 Desktop iframe。共享声明通过标准 `/types` 出口配合 `import type` 引入；Host 与 Client 使用独立 tsconfig 编译。

页面刷新快捷键调用工具栏使用的同一重载操作。其 Tooltip 和 ARIA 组合随有效绑定更新。社区 Desktop 没有带租约的 Browser guest；Web 保留浏览器专用组合。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [右侧 Sidebar](../../../docs/subsystems/sidebar-right.zh.md)——tab composition、导航与生命周期。
- [Document Preview](../ui-sidebar-documentpreview/README.zh.md)——本地源码、Markdown、图片、HTML 与 PDF 渲染。
- [Sidebar Browser 决策](../../../.agents/notes/implemented/feature/2026-09-16-sidebar-browser.zh.md)——iframe 行为与 controller 所有权。
- [Desktop Browser 决策](../../../.agents/notes/implemented/feature/2026-09-20-desktop-browser-webview.zh.md)——webview 租约、CWD 存储分组与手动恢复。

-----

<a id="model-experience"></a>
## 模型体验

无。Browser tab 是用户侧呈现状态，不注册工具、prompt section 或 Session event。

#### KV Cache 影响

无；浏览内容不进入模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

隔离策略有意放弃部分浏览器兼容性：

- 很多站点拒绝 iframe 嵌入，或需要社区 Desktop frame 不授予的下载、popup 与顶层导航。HTTPS 应用还可能按 mixed-content 策略阻止公共 HTTP 页面。Web 可以临时关闭 sandbox 以提高兼容性，但这不能绕过 mixed-content 或 private-network 策略，并会允许顶层导航、下载、对话框与输入锁定。两种载体都不按 Browser tab 隔离被访问 origin 的 Cookie，也无法阻止 iframe 内页面自行选择后续 URL。
- 在 Web 中，逃逸出 sandbox 的 popup 会保留 opener，并可以导航顶层应用。社区 Desktop 拒绝嵌入页 popup；要在系统浏览器中打开最后已知 URL，使用工具栏操作。依赖 iframe 内 `window.open` 的站点需要改在系统浏览器中使用。
- 后续 iframe load 能表明发生了导航，但无法给出新的跨域 URL。History API 与 fragment 变化可能仍不可见；状态变成 unknown 后，iframe 的后退与前进不可用。
- 出于安全原因，浏览器会隐藏很多 iframe 失败：DNS、TLS、mixed-content、CSP 与 `X-Frame-Options` 失败可能触发 `load`，也可能不提供可操作 event，而不是触发 `error`。加载失败 notice 只能作为 best-effort 提示。
- 只要 tab 仍在 Sidebar 布局中，保存的标题和 URL 就会跨刷新与插件卸载保留。关闭 tab 会删除其检查点。重启恢复不恢复页面内存、未保存的表单或 Chromium history 栈。
- 本地文件会被拒绝，并继续由 Document Preview 负责。
- 社区 Desktop iframe 不使用逐 Workspace 存储分区、guest 租约或 WebView 权限策略。被访问 origin 与主渲染进程共用浏览器 session；固定 sandbox 和主进程导航检查能降低暴露，但不能提供 guest 进程或 Cookie 隔离。Harness 地址检查并非通用私有网络或 DNS 重绑定防火墙。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布 companion。每个导航 provider 拥有自身的实时状态并直接发布检查点；UI 通过 controller 消费同一份 provider 状态。
