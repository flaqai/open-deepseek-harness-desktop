# DeepSeek Harness Desktop

[English](README.md) | 中文

`@deepseek-ai/dsh-desktop` 是现有 DeepSeek Harness Web GUI 的原生应用宿主。它启动一个本地 Harness 进程，等待规范的就绪输出，再用经过加固的 Electron 窗口加载该回环地址。桌面应用不会把会话、Provider、插件或 Skill 状态复制到应用专用格式中。

## 从当前仓库运行

使用 Node `^22.19.0 || >=24.0.0`，先构建仓库，再启动桌面应用：

```sh
pnpm install
pnpm run build
pnpm run dev:desktop
```

桌面 `dev` 命令会监听宿主源码，短暂防抖后重新构建，并且只在构建成功后重启 Electron。构建失败时当前应用继续运行，监听器会在下一次编辑后重试。

应用提供与 `dsh web` 相同的引导和设置界面。用户无需维护第二份配置，即可配置 DeepSeek 或其他兼容 API Provider、选择模型、查看已安装插件、编辑受支持的插件设置、调用 Skill、选择工作区并管理会话。

打包版本内置固定的 `dshmarket@1.12.1`、`@xmanrui/dsh-im@0.11.0` 和 `dsh-skill-picker@0.2.0` 归档，作为 Web profile 离线、可卸载的首次启动种子。每个持久种子标记都会在用户卸载后保留，因此后续启动不会擅自装回用户已经移除的插件。

## 桌面发行包

在架构匹配的 Mac 上使用下列命令构建 ad-hoc 签名、未公证的 macOS 软件包：

```sh
npm run package:desktop:macos:arm64
npm run package:desktop:macos:x64
```

产物写入 `.artifacts/desktop-macos/`。每个安装包在同一个运行时归档中内嵌目标平台的 Harness 生产依赖闭包、Node 24.11.1 和 pnpm 11.7.0；准备脚本仅在固定 Node 归档与官方 SHA-256 一致时接受它。首次启动时，应用会把归档解压到按版本隔离的用户数据目录，使 Node ESM 能看到真实的 `node_modules` 层级。内置 Node 负责启动 Harness，插件管理器通过绝对路径使用内置 pnpm，插件生命周期脚本的 `PATH` 则以内置运行时的 `bin` 目录开头。布局标记会让不完整的安装包缓存自动失效。

在 Windows 上使用下列命令构建未签名的 Windows x64 NSIS 安装程序：

```sh
npm run package:desktop:win:x64
```

安装程序写入 `.artifacts/desktop-windows/DeepSeek-Harness-windows-x64.exe`。它包含官方 Windows x64 Node 24.11.1 可执行文件、pnpm 11.7.0，以及保留真实 `node_modules` 层级且无符号链接的 Harness 生产依赖闭包，用户无需在 `PATH` 中安装 Node 或 pnpm。Electron Builder 运行前，准备脚本会校验官方 Node 归档的 SHA-256、必需的 Windows 原生模块、内置 pnpm 版本，并实际启动 Harness 等待就绪。

在 Linux 上使用下列命令构建 Linux x64 软件包：

```sh
npm run package:desktop:linux:x64
```

DEB 与 RPM 文件写入 `.artifacts/desktop-linux/`。与 macOS 相同，它们包含目标平台原生的 Node、pnpm 与 Harness 生产运行时归档。`Desktop packages` 工作流会运行四个原生任务，上传五种安装包并生成 `SHA256SUMS`。手动运行默认只保留 Actions artifact；仅从 `dsh-v*` 标签明确要求发布，或推送该标签时，才会使用固定平台文件名创建或更新对应 GitHub Release。

## 进程生命周期

Electron 主进程不经过 shell，直接启动 `node apps/cli/lib/bin.js web --host 127.0.0.1 --port 0`。所有打包平台都使用内置的目标平台原生 Node，不使用 Electron 或用户安装的 Node 可执行文件。宿主只把 `dsh web: http://127.0.0.1:<port>` 识别为就绪信号，将 stdout 和 stderr 追加到 Electron 的平台日志目录；应用退出时先发送 `SIGTERM`，超过固定期限后再发送 `SIGKILL`。默认关闭窗口只会隐藏到系统托盘；用户可以改为关闭即请求完整退出，所有显式退出都会等待 Harness 清理。Harness 在就绪前连续退出三次后会停止自动重启，并显示重试与日志操作。连接页等待十五秒后也会显示同一个固定日志入口，但不会把缓慢启动判为失败。

托盘可以恢复窗口、定位 Harness 日志、切换通知、启用已打包 macOS 的登录启动或退出。崩溃、最终启动失败和恢复通知均可关闭并按事件节流。桌面偏好以原子方式存入 Electron `userData`；非法字段会各自恢复安全默认值。

可通过 `DSH_DESKTOP_DSH_BIN` 测试其他已构建的 `dsh` 启动文件。若 Electron 继承的环境无法找到 `node`，可设置 `DSH_DESKTOP_NODE_BIN`。

## 官方源码更新

桌面源码运行模式会在「通用设置」中显示 **DeepSeek Harness 底层更新**。它从固定官方仓库 `https://github.com/deepseek-ai/deepseek-harness.git` 检查 `master`，展示当前提交和已拉取提交；仅当本地提交是官方提交的祖先且工作树干净时才启用升级。已经包含该官方提交的分叉视为最新；发生分叉的历史必须人工合并。

用户确认后，升级器快进工作树，通过桌面 Harness 所选的 Node 可执行文件运行 `pnpm install --frozen-lockfile`，再执行完整仓库构建。依赖安装与构建子进程不会继承名称包含凭据特征的环境变量。准备失败时，升级器把工作树重置到原提交并重新准备该版本；如果恢复失败，结果会明确报告回退不完整，而不会把旧构建显示为健康状态。升级成功后需重启应用，设置卡片会提供该操作。

只有在测试另一个可信工作树时才设置 `DSH_DESKTOP_SOURCE_ROOT`。没有 Git 工作树的安装包不会运行该升级器；安装包自动更新仍以签名发布元数据和可用回退为前提。

## 打包版本的 Release 发现

打包应用会在启动后和用户明确请求时检查 `https://github.com/flaqai/open-deepseek-harness-desktop` 的 Releases。稳定版忽略预发布；rc 或 beta 客户端跟随同名预发布通道，也接受更高稳定版。可用版本会显示在“设置”上方和“通用设置”中。操作只会在系统浏览器打开经过校验的 GitHub Release 页面；应用不会下载、安装或替换安装程序。

## 安全性

渲染进程使用 `nodeIntegration: false`、`contextIsolation: true` 和 `sandbox: true`。导航仅允许 Harness 进程对应的精确回环来源。新开的 HTTPS 窗口交给系统浏览器，其余新窗口全部拒绝。除受监管 Harness 来源的主框架发起的安全剪贴板写入外，渲染进程的权限请求全部拒绝；剪贴板读取和其他所有权限仍保持拒绝。因此，共用客户端可直接使用标准 Web Clipboard API，而不必暴露通用的高权限 Electron bridge。

API 密钥仍由 Harness credentials 服务持有；桌面宿主不会读取或复制密钥。沙箱 preload 在源码运行中暴露类型化源码更新调用，并提供桌面能力、偏好更新、固定日志定位与 Release 发现。Release URL 仅限本仓库，渲染进程不能提供文件路径。在 Windows 和 Linux 上，preload 还会渲染桌面宿主自有标题栏，并将固定的最小化、最大化或还原、关闭意图直接发送给主进程。它不暴露通用命令、文件系统、URL 打开、下载或安装方法。

Profile 插件属于可信的可执行代码。内置包管理运行时让插件的 pnpm 生命周期脚本使用确定的工具版本，但不会对从 registry、Git 仓库、tarball 或本地 checkout 安装的代码提供沙箱或背书。

## 跨平台发行矩阵

源码宿主只使用 macOS、Windows 和 Linux 共用的 Electron 与 Node 进程 API。macOS 保留原生标题栏与交通灯按钮；Windows 和 Linux 使用无系统边框窗口，由 Harness 自绘可拖拽标题栏及最小化、最大化或还原、关闭按钮。打包工作流会在匹配的原生运行器上构建以下矩阵：

| 平台 | 原生运行器 | 产物 |
| --- | --- | --- |
| macOS arm64 | `macos-15` | DMG 与 ZIP |
| macOS x64 | `macos-15-intel` | DMG 与 ZIP |
| Windows x64 | `windows-2025` | NSIS EXE |
| Linux x64 | `ubuntu-24.04` | DEB 与 RPM |

Windows 任务会把最终 NSIS 产物静默安装到包含空格和中文字符的路径，检查安装后的运行时，使用隔离的应用数据启动已安装程序，并在上传产物前要求 Harness 输出就绪行，同时确认三个预设依赖与 bundle 条目、Profile 锁文件和持久化 seed 标记均已生成。其他平台仍需完成原生安装、首次启动、退出、子进程清理、目录选择、文件打开、PTY 与沙箱行为的发布验证。只有在发布签名与回滚可用后才添加已签名的更新元数据。

不得通过把整个工作区源码复制进 Electron 来打包仓库。发布产物必须只包含已发布的运行时闭包、生成的第三方声明，且不得包含开发凭证。

## 扩展方向

桌面专属行为保持在 agent loop 之外。插件与 Skill 管理继续使用 Harness 服务和现有设置界面。远程控制应通过 transport 插件接入：它把经过身份验证的 IM 会话映射为持久化 Harness 会话输入，并通过 interaction 服务回传审批或问题答复。微信、Discord 和 Slack 适配器应作为建立在公共 transport 服务之上的独立 Provider 插件，并明确实现身份映射、授权、审计事件、限流和撤销。

后续桌面里程碑依次为已签名安装器、审批请求的原生通知、托盘状态、深层链接和经过身份验证的本地控制端点。内置浏览器、Git 面板、终端和插件市场只应作为由 Harness 服务支撑的 client 插件加入，不能依赖 Electron 专属状态。

## 限制

- 当前源码运行需要已构建的仓库和兼容的 Node 可执行文件。
- macOS arm64 与 x64 的 DMG 和 ZIP 使用 ad-hoc 签名且未公证；首次启动时需要用户在 Gatekeeper 中明确授权。
- Windows x64 安装程序未签名，Linux x64 软件包也没有仓库签名；用户必须核对 `SHA256SUMS` 与发布来源。
- Developer ID 签名、公证、安装包自动安装、Windows/Linux 登录启动、深链接和 IM 控制尚未实现。源码升级器只接受来自官方 `master` 的干净快进更新；本地分叉仍需人工处理。
- Windows 打包任务会在构建运行器上验证安装和 Harness 就绪；macOS 与 Linux 打包任务仍只证明原生组装完成，还需安装与运行时验证。
