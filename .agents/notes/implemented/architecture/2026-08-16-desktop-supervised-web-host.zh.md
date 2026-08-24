# Agent Note: 桌面应用以受监管的本地进程运行 Web profile

Status: implemented

[English](2026-08-16-desktop-supervised-web-host.md) | 中文

## 问题

DeepSeek Harness 已经拥有浏览器界面、Provider 和模型配置、插件设置、Skill 调用、会话、工作区与交互请求。原生应用仍需让用户无需终端即可启动产品、保持其运行、呈现启动状态，并约束桌面 Web 渲染器带来的额外权限。

另建一套桌面客户端会重复实现 client plugin roster 和持久化模型。它还会让每项 Harness UI 能力在独立客户端尚无协议版本约定时，就必须维护两条发布路径。

源码宿主必须先建立 macOS 开发路径，同时不能把尚不存在的广泛安装包能力说成已经支持。Windows 与 Linux 也需要一个不编码 macOS 专属生命周期行为的架构。

## 决策

`apps/desktop` 是位于 `packages/` 之外的 Electron 应用装配。主进程直接启动已构建的 `dsh` launcher，以 `127.0.0.1` 和端口 `0` 运行 `web` profile，再从规范的 `dsh web:` 就绪输出加载精确 URL。渲染进程就是现有 Web GUI；桌面应用不会把 client plugin、API Provider 设置、凭证、会话或 Skill 复制到第二套应用模型中。

一个 `HarnessSupervisor` 负责子进程、合并追加日志、意外退出后的重启延迟和有界退出。启动通过 argv 数组完成，不经过 shell。就绪信号只接受字面量 `127.0.0.1` 上的 HTTP URL；无关输出和非回环 URL 都不能决定渲染进程导航。

BrowserWindow 启用 context isolation 和渲染进程 sandbox，并关闭 Node integration。顶层导航仅限已选定的回环来源。新开的 HTTPS 窗口交给系统浏览器，其余窗口创建全部拒绝。除精确的受监管 Harness 来源主框架发起的安全剪贴板写入外，渲染进程权限全部拒绝；剪贴板读取仍保持拒绝。共用客户端使用标准 Web Clipboard API，因此不新增通用的高权限剪贴板 bridge。

macOS 保留原生标题栏和交通灯按钮。Windows 和 Linux 创建无系统边框的 BrowserWindow；沙箱 preload 在加载页和 Web GUI 上方插入一条桌面宿主自有、跟随主题 token 的 36 px 标题栏。可拖拽区域显示当前文档标题，固定的最小化、最大化或还原、关闭按钮发送窄范围 IPC 意图，主进程只接受当前桌面窗口的请求。这两个平台的 Harness 导航通过 `dsh-desktop-titlebar-inset` URL 参数声明同一高度，使固定或全视口 Web 插件为桌面 chrome 预留空间，而不会渲染到其下方。Web 客户端既不拥有也不暴露这些操作系统控制能力。

源码运行仍要求兼容的 Node 可执行文件和已构建的仓库。macOS arm64 包组合扁平化的第三方生产 deploy、传递性的 workspace 运行时闭包、Node 24.11.1 与 pnpm 11.7.0；准备脚本会先验证固定的 Node 官方归档 SHA-256，再进行解压。应用首次启动时把归档解压到按版本隔离的用户数据目录，布局标记会让不完整缓存失效。内置 Node 负责启动 Harness；宿主把 `DSH_PNPM_BIN` 固定为内置 pnpm，并以内置运行时的 `bin` 目录作为 `PATH` 开头，使插件生命周期脚本使用同一个 Node。DMG 与 ZIP 均为未签名的开发验证产物。

## 扩展归属

桌面 chrome 只拥有操作系统生命周期与呈现。模型配置、插件清单与配置、Skill 发现与调用、工作区选择、审批和会话状态仍以 Harness 服务为权威来源。

未来的微信、Discord 与 Slack 控制通过 Harness transport 服务及其 Provider 插件接入。每个适配器把经过身份验证的平台身份映射到 Harness principal 和持久化会话，并使用 interaction 服务处理审批与问题。身份映射、授权、审计事件、撤销和限流不属于 Electron，也不应成为 agent loop 条件分支。

## 曾考虑的替代方案

- **重新实现桌面专属 React GUI：** 否决，因为它会重复现有的插件组合客户端、产生配置漂移，并迫使每项功能维护两套 UI 集成。
- **加载已构建的前端文件并通过 Electron IPC 承载 API：** 延后，因为当前 Web profile 已提供经过装配和测试的回环 carrier。只有当桌面威胁模型或独立发布客户端需要第二套 transport 实现与协议兼容策略时，IPC 才值得引入。
- **通过 preload IPC 暴露 Electron 原生剪贴板：** 否决，因为精确来源的权限放行可以让共用客户端继续使用标准 Web Clipboard API，无需扩大 preload 接口或创建桌面专属剪贴板行为。
- **保留 Windows 和 Linux 原生标题栏：** 否决，因为桌面宿主要求在这两个平台提供一致的 Harness chrome；macOS 继续保留原生标题栏，因为交通灯位置与平台惯例仍应由系统决定。
- **在共用 Web 客户端内实现标题栏控制：** 否决，因为浏览器构建不拥有操作系统窗口生命周期。标题栏由 preload 渲染，其固定 IPC 意图不会暴露给普通 Web 代码。
- **首个宿主使用 Tauri：** 本里程碑否决，因为 Harness 运行时与 PTY 栈本来就需要 Node，Rust shell 无法消除该运行时，却会在打包尚未解决时增加第二套工具链。应用装配让 Harness 服务保持与 Electron 无关，因此未来仍可替换为其他原生宿主。
- **打包整个工作区 checkout：** 否决，因为它会包含开发专用文件、形成未经审计的依赖集合，并削弱第三方声明与凭证排除保证。安装包应使用已发布运行时闭包。
- **重命名 `node_modules` 并仅通过 `NODE_PATH` 暴露：** 否决，因为 Node ESM 不使用 `NODE_PATH`，workspace 包中的 bare import 仍会失败。macOS 包改为在归档中保留真实依赖层级，并在 ASAR 外解压。
- **从用户登录 Shell 导入 pnpm：** 否决，因为 Finder 启动不会读取 Shell 启动文件，而主动求值这些文件会执行用户配置，并使启动时可用性不确定。安装包拥有两个可执行文件并传递绝对路径。
- **在这台 macOS 机器上构建 NSIS 安装器：** 延后，因为它需要 Windows 兼容打包环境和签名策略。首个交付物是完成结构验证的 Windows x64 ZIP。

## 结果

macOS 开发者可以通过一个命令打开完整 Harness GUI，并监管其真实本地进程。窗口直接继承所有 Provider、插件、Skill、工作区与会话改进，无需桌面专属同步。

回环 HTTP server 仍属于桌面进程树。它已有的 Host 与 Origin 防线因此仍是安全关键；Electron 窗口没有添加任何可绕过防线的高权限 bridge。Profile 插件仍是可信的可执行代码：确定性选择 Node 与 pnpm 不会对 registry 或 Git 生命周期脚本提供沙箱。

Windows 与 Linux 的源码兼容来自共用的 Electron 与 Node 进程 API，但不代表已经支持发布。Windows ZIP 原型仍需采用同样可由 ESM 真实解析的运行时层级，才能进行原生验证。原生执行、进程树验证、签名、安装器、公证与更新回滚仍属于发布工作，并在桌面 README 中明确列为限制。

聚焦测试固定跨 chunk 就绪解析与直接启动解析。现有 Web e2e 套件继续承担产品界面覆盖，因为桌面渲染进程运行的就是同一个装配后应用。
