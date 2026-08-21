<p align="center">
  <img src="./apps/desktop/src/icon.png" width="112" alt="Open DeepSeek Harness Desktop 图标">
</p>

<h1 align="center">Open DeepSeek Harness Desktop</h1>

<p align="center">
  <strong>面向 DeepSeek Harness 的开放、可扩展桌面工作区</strong>
</p>

[English](README.md) | 中文

<p align="center">
  <a href="https://github.com/flaqai/open-deepseek-harness-desktop/releases"><img src="https://img.shields.io/github/downloads/flaqai/open-deepseek-harness-desktop/total.svg?style=flat" alt="下载量"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/flaqai/open-deepseek-harness-desktop?style=flat" alt="MIT 许可证"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/upstream-DeepSeek%20Harness-4d6bfe?style=flat" alt="DeepSeek Harness 上游"></a>
</p>

Open DeepSeek Harness Desktop 是由社区独立维护的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 桌面发行版。它将上游基于插件的智能体运行时与可视化工作区结合起来，可用于配置模型、运行编码会话、查看执行过程和管理扩展。

本仓库并非 DeepSeek 官方产品。项目采用 [MIT 许可证](LICENSE)，并保留 Harness 的架构原则：各项能力仍由插件提供，Electron 应用仅作为现有 Web 客户端的安全本地宿主。

**开发提示：** Open DeepSeek Harness Desktop 正在积极开发中，功能、打包方式和本地数据结构可能发生变化。本项目由社区独立维护，并非 DeepSeek 官方产品。

## 相比官方 Web 版的桌面增强

本项目保留 DeepSeek Harness 官方 Web 客户端的使用体验，并加入适合桌面应用的系统集成和开箱即用功能。

### 客户端复制

Electron 宿主仅向受监管的 Harness 页面授予经过净化的剪贴板写入权限，因此消息、代码和对话的复制按钮可以像官方 Web 端一样在桌面客户端正常使用。剪贴板读取及其他无关的浏览器权限仍保持禁用。

### 预装插件市场

安装包内置插件市场，并在首次启动时完成预设安装，无需额外配置即可发现、安装和管理插件。插件市场仍是普通 Harness 插件：用户可以在客户端中将其卸载，桌面应用会尊重该选择，不会再次自动安装。

### 预设 IM 机器人连接

安装包预设 `dsh-im`，可从客户端设置中通过扫码、应用清单或已有机器人凭据连接微信、飞书、钉钉、企业微信、QQ、Slack、Telegram、Discord 和 WhatsApp。不同渠道统一在一个 IM 管理入口中配置，并可为机器人切换 Harness 工作区或重新绑定已有会话。机器人凭据只提交给本机 Harness Host，并由受保护的凭据存储管理。该功能仍由可卸载插件提供；用户移除后，客户端不会在后续启动时擅自装回。

### 依赖诊断与插件隔离

客户端能够识别插件依赖图中的共享运行时冲突、残留的 Loader 条目和根插件挂载失败等问题。只读检查会先展示问题及依赖链；执行修复时，客户端尝试让插件统一使用安装包提供的共享 Host 依赖。仍无法安全收敛的插件会从当前 profile 的活动依赖和启动顺序中移出，并留下持久的隔离记录，因此其他功能仍可继续启动。用户之后可以在“设置 → 插件 → 诊断”中重试安装，或确认后卸载隔离残留。

这项能力必须位于客户端启动层，而不能做成普通插件：插件只有在依赖解析和运行时装载成功后才能执行，而依赖冲突恰好可能发生在这之前，并阻止诊断插件自身启动。只有拥有 profile 清单、锁文件、组合包顺序和安装级共享运行时的启动层，才能在插件代码执行前完成检查，以统一规则停用故障插件，并在修复失败时保持关闭式保护。隔离不会把未知依赖错误静默忽略，也不会让故障插件继续进入当前运行时。

### 主题与背景

你可以在跟随系统、浅色、深色及八套产品主题之间切换，并搭配八张原创内置插画，或使用自己的 PNG、JPEG、WebP 图片替换聊天背景。自定义图片仅保存在本地浏览器存储中，不会发送给模型。支持格式与大小限制见[主题与背景参考](packages/client/ui-theme/README.md)。

<table>
  <tr>
    <th width="50%">主题栏</th>
    <th width="50%">背景栏</th>
  </tr>
  <tr>
    <td align="center"><img src="./assets/readme/theme-settings-zh.png" alt="中文主题栏设置"></td>
    <td align="center"><img src="./assets/readme/background-settings-zh.png" alt="中文背景栏设置"></td>
  </tr>
</table>

## 发布状态

项目目前处于开发者预览阶段，可能发生破坏兼容性的变更。我们将准备下方列出的五种桌面发行版本。macOS Apple Silicon 是首个在本地完成打包与验证的目标；其他行代表已经确定的发行矩阵，会在对应原生构建与验证工作完成后提供下载。

## 现有能力

- 默认接入 DeepSeek，也可在首次引导或设置中配置兼容 API 的基础地址、API 密钥引用和自定义模型标识。
- 打开本地工作区、创建持久会话、流式接收智能体回复、复制消息、删除会话和清空对话记录。
- 查看进入模型上下文的执行记录与精简的关键步骤摘要，便于确认重要工具操作。
- 调用 Skill，并通过 Cordis 插件扩展产品。
- 检查固定的官方上游稳定变更，并在桌面源码运行模式下执行受保护的干净快进更新。

## 安装

请只从本项目的官方 [GitHub Releases](https://github.com/flaqai/open-deepseek-harness-desktop/releases) 页面下载安装包。发行产物将遵循以下矩阵：

| 平台 | 架构 | 发行包 |
| --- | --- | --- |
| macOS | Apple Silicon（`arm64`） | `DeepSeek-Harness-macos-arm64.dmg` |
| macOS | Intel（`x64`） | `DeepSeek-Harness-macos-x64.dmg` |
| Windows | `x64` | `DeepSeek-Harness-windows-x64.exe` |
| Linux | Debian / Ubuntu（`x64`） | `DeepSeek-Harness-linux-x64.deb` |
| Linux | Fedora / RHEL（`x64`） | `DeepSeek-Harness-linux-x64.rpm` |

正式发布时还会提供 `SHA256SUMS` 文件，便于在安装前校验下载产物。只有实际出现在 Releases 页面中的文件才属于可用版本；此表本身不代表对应安装包已经发布。

### macOS

1. 下载与 Mac 处理器相符的安装包并打开 `.dmg`。
2. 将 `DeepSeek Harness.app` 拖入“应用程序”文件夹。
3. 当前开源构建使用 ad-hoc 签名且未经 Apple 公证。若 Gatekeeper 阻止首次打开，请前往**系统设置 → 隐私与安全性 → 仍要打开**。也可以在确认文件来自本仓库后执行：

   ```bash
   xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness.app"
   ```

> [!CAUTION]
>
> 移除 quarantine 属性会绕过 macOS 安全检查。此命令仅适用于从官方 Releases 页面下载并安装到上述准确路径的 `DeepSeek Harness.app`，切勿将路径替换为宽泛目录。也可以前往**系统设置 → 隐私与安全性**，尝试 Apple 的[“仍要打开”](https://support.apple.com/102445)功能。

### Windows

下载并运行 Windows x64 安装程序。对于未签名或刚发布的版本，Windows 可能显示基于信誉的安全警告；继续安装前请确认仓库来源并核对发行校验值。

### Linux

请选择与发行版匹配的软件包：

```bash
# Debian / Ubuntu
sudo apt install "/path/to/DeepSeek-Harness-linux-x64.deb"

# Fedora / RHEL
sudo dnf install "/path/to/DeepSeek-Harness-linux-x64.rpm"
```

<a id="run"></a><a id="run-from-source"></a>

## 快速开始

安装 Node.js `^22.19.0 || >=24.0.0` 与 pnpm `11.7.0`，然后执行：

```sh
git clone https://github.com/flaqai/open-deepseek-harness-desktop.git
cd open-deepseek-harness-desktop
pnpm install
pnpm run build
pnpm run dev:desktop
```

桌面宿主会启动本地 Harness 进程，并在经过加固的 Electron 窗口中打开其回环地址 Web UI。若只需从同一份源码运行 Web 客户端：

```sh
pnpm dsh web
```

环境变量覆盖、进程监管、更新行为和现有限制见[桌面应用参考](apps/desktop/README.md)。浏览器端工作流见 [Web UI 指南](docs/user/guide/index.md)。

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。Web 命令默认在 `http://127.0.0.1:3080` 启动，并在本机启动时打开默认浏览器。传入 `--no-open` 可只运行服务器；Electron 宿主始终使用该模式。

## 平台状态

| 平台 | 当前状态 | 后续发布工作 |
| --- | --- | --- |
| macOS Apple Silicon | 已在本地验证 ad-hoc DMG/ZIP 打包 | 发布并验证 arm64 发行产物 |
| macOS Intel | 已具备共享的 Electron/Node 实现 | 在兼容 Intel 的运行器上构建并验证 x64 DMG |
| Windows x64 | 已具备共享的 Electron/Node 实现 | 构建 EXE 安装程序，验证进程、PTY、文件系统和沙箱行为 |
| Linux x64 | 已具备共享的 Electron/Node 实现 | 构建并验证 Debian 与 RPM 软件包 |
| Web | 可通过源码命令 `pnpm dsh web` 使用 | 继续与桌面端共享相同的 Harness 服务和配置 |

## 架构

```mermaid
flowchart LR
    D["Electron desktop host"] --> W["Loopback Web client"]
    W --> H["Harness Host APIs"]
    H --> R["Cordis plugin runtime"]
    R --> M["Models + prompts"]
    R --> T["Tools + policy + sandbox"]
    R --> S["Sessions + storage"]
    R --> E["Plugins + Skills + workflows"]
```

DeepSeek Harness 采用由 [Cordis](https://github.com/cordiverse/cordis) 驱动的**一切皆插件**架构。桌面窗口不会成为第二套运行时：配置、凭据、会话、插件和 Skill 仍由 Harness 服务统一管理。修改软件包前，请先阅读[架构文档](docs/architecture.md)和[开发指南](docs/development.md)。

## 插件与 Skill

首页和设置界面提供插件发现与受支持的安装操作。注册表安装会校验包标识、要求明确确认、流式展示命令输出并返回需要重启的结果；它不是通用 Shell 输入框。为兼容插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，可帮助用户发现插件。

Skill 继续由 Harness 提供程序管理，并与智能体的其他能力在同一会话上下文中调用。插件作者应使用已有的服务定义、提供程序、消费者、effect 和配置机制，不应依赖 Electron 专属状态。

## 安全与隐私

渲染进程禁用 Node 集成，启用上下文隔离和 Chromium 沙箱。页面导航仅允许准确的 Harness 回环来源，渲染进程权限请求会被拒绝，Web 内容也无法访问通用命令或文件系统桥接。

API 密钥仍由 Harness 凭据服务管理，请勿提交凭据。选择任何兼容提供商前，请核对其端点、模型支持、工具调用行为、价格、速率限制和数据处理条款。

## 项目方向

- 提供可复现的 macOS arm64/x64 DMG、Windows x64 EXE 和 Linux x64 DEB/RPM 版本，并附带校验值与第三方许可证声明。
- 改进插件与 Skill 的发现、兼容性元数据、生命周期管理和更新可见性。
- 增加原生审批、通知、托盘状态、深度链接和经过身份验证的本地控制端点。
- 继续完善预设 IM 机器人连接的身份映射、授权、审计事件、速率限制和撤销能力。

以上内容是项目方向，并不代表已经完成支持。当前实现边界见[桌面发行矩阵](apps/desktop/README.md#cross-platform-release-matrix)。

## 文档与社区

- 阅读[用户指南](docs/user/guide/index.md)、[插件介绍](docs/user/develop/framework/index.md)和 [Skill 指南](docs/subsystems/skills.md)。
- 通过 [GitHub Issues](https://github.com/flaqai/open-deepseek-harness-desktop/issues) 提交可复现的缺陷和功能建议。
- 在 [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 或其 [Discord 社区](https://discord.gg/Ycq5dCaS4)讨论上游运行时。
- 贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；使用编码智能体处理本仓库时请遵循 [AGENTS.md](AGENTS.md)。

## 致谢

感谢以下社区插件的作者与维护者。它们作为可卸载的首次启动预设随桌面安装包提供，让常用扩展能力可以开箱即用：

- [`dsh-im`](https://github.com/xmanrui/dsh-im)，由 [xmanrui](https://github.com/xmanrui) 维护：连接微信、飞书等九种 IM 机器人。
- [`dsh-skill-picker`](https://github.com/a735624258/dsh-skill-picker)，由 [a735624258](https://github.com/a735624258) 维护：在输入区选择 Skill，并插入 Harness 的 Skill 调用指令。
- [`dsh-market`](https://github.com/dsh-market/dsh-market)，由 [dsh-market](https://github.com/dsh-market) 社区维护：在 Harness 内浏览、搜索、安装和管理插件。

## 关于 FLAQ.AI

[FLAQ.AI](https://flaq.ai/) 通过 API、文档和面向开发者的工作流提供图像、视频、音频及语言模型能力。如果其当前 API 与模型能力符合项目需求，可将它作为可选兼容提供商或配套平台进行评估。

运行本仓库不依赖 FLAQ.AI，项目也不会将其设为隐藏的默认服务；提及 FLAQ.AI 不代表 DeepSeek 对其背书。提供商可用性和商业条款可能变化，使用前请在 [FLAQ.AI 文档](https://flaq.ai/docs/)中核对最新信息。

## 许可证

Open DeepSeek Harness Desktop 采用 [MIT 许可证](LICENSE)。第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
