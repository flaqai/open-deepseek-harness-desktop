# DeepSeek Harness Desktop

[English](README.md) | 中文

`@deepseek-ai/dsh-desktop` 是现有 DeepSeek Harness Web GUI 的原生应用宿主。它启动一个本地 Harness 进程，等待规范的就绪输出，再用经过加固的 Electron 窗口加载该回环地址。Harness 数据仍保持普通格式，但存放在桌面端自有 home 中，不再实时共享官方 CLI 的 `~/.dsh` 目录树。

## 从当前仓库运行

使用 Node `^22.19.0 || >=24.0.0`，先构建仓库，再启动桌面应用：

```sh
pnpm install
pnpm run build
pnpm run dev:desktop
```

桌面 `dev` 命令会监听宿主源码，短暂防抖后重新构建，并且只在构建成功后重启 Electron。构建失败时当前应用继续运行，监听器会在下一次编辑后重试。

应用提供与 `dsh web` 相同的引导和设置界面。用户无需维护第二份配置，即可配置 DeepSeek 或其他兼容 API Provider、选择模型、查看已安装插件、编辑受支持的插件设置、调用 Skill、选择工作区并管理会话。

<a id="application-menus"></a>
## 应用菜单

应用菜单提供新对话、设置、插件管理与恢复、诊断、快照、外部工具、手机访问、IM 机器人、数据目录切换、更新、日志和项目帮助。“新对话”复用现有工作区流程，不发送消息。插件页面缺失时给出说明，不会自动安装插件。“检查更新”打开通用设置，不退出应用或安装更新。

macOS 使用名为 Open DSH Desktop 的系统原生菜单。Windows 与 Linux 在独立的 36 px 标题栏中显示横向菜单、应用图标、可拖动标题和窗口按钮。窄窗口会把菜单收进“更多”。原生弹出菜单可以超出顶栏高度，但不在 Harness 内部覆盖插件。编辑操作保留原始文本目标；缩放只影响 Harness。菜单文案跟随客户端语言，缺失语言回退为英文。开发者工具只在源码运行时提供。

“快速重启”和“完整退出”需要等待进行中的插件修改及恢复完成。普通关闭保留用户的隐藏或退出偏好。托盘创建失败时，后台启动会显示窗口，“隐藏到托盘”会提供取消或完整退出，避免窗口无法访问。Linux 不会从托盘对象创建成功推断图标实际可见，设置中会说明其对桌面环境的依赖。Linux 更新操作保留现有 Release 页面回退，不宣称支持安装 DEB/RPM。

macOS 开发启动器会在 `.artifacts/desktop-dev/` 中按版本创建 ad-hoc 签名的 Open DSH Desktop.app，不修改共享 Electron 安装、Bundle 标识、数据位置或已保存的自定义图标。macOS 安装版通过 Bundle 元数据使用相同菜单显示名。实现与平台验证限制记录在[应用菜单决策](../../.agents/notes/implemented/feature/2026-09-03-desktop-application-menus.zh.md)中。

## 独立数据目录与导入

安装版使用平台应用数据根下的 `open-deepseek-harness-desktop/dsh-home`，源码开发版使用其中的 `development/dsh-home`。两者的 Electron 偏好、浏览器会话数据、日志、解压运行时和 Harness 状态彼此独立，也不再与官方 CLI 共用。自动化和高级启动显式设置的 `DSH_HOME` 仍具有最高优先级。

首次普通启动时，如果发现官方 `~/.dsh`，应用会在 Harness 启动前提供三个选择：把受支持的用户数据导入独立 home、直接复用官方 home，或全新开始。导入与全新开始会进入第二步，让用户保留桌面版管理的默认位置，或选择一个既有空文件夹作为独立配置目录；直接复用仍把经识别的来源本身作为活动 home。自定义目标由 Electron 生成短期不透明选择标识，并在最终路径确认后再次检查为空，渲染层不能提交任意路径。选择页默认跟随操作系统语言，并提供即时中英文切换。导入模式通过拒绝符号链接的白名单处理设置、凭据、会话、工作区元数据、Agent 预设、Skill 与连接状态，且不修改来源；Profile、`node_modules`、锁文件、预装插件 marker、隔离与健康状态、匿名用户 id 均不会复制。应用会另行把 Web Profile 依赖与 bundle 的有序交集记录到 `imported-plugin-restore.v1.json`，并且只提取布尔型 `allowBuilds` 条目。进入客户端后，一次性弹窗与“插件”页面允许用户选择可迁移的 registry、npm alias 和不含凭据的 Git 插件，并通过现有 CLI 串行重新安装；本地来源与带凭据来源会显示原因但不能执行。桌面预置插件先完成核对，同名恢复项显示为客户端已提供。精确构建许可合并到独立 Profile，`false` 优先，任何全局安全降级均被忽略。由于不复制官方锁文件，声明版本范围可能解析到更新的兼容版本。导入只会从复制得到的设置中删除 `ui-onboarding` 完成记录，使独立桌面环境显示自己的设置向导；其余受支持设置保持不变。复用模式会有意共享官方 Profile、插件、构建许可与向导状态，任一应用的修改都会作用于同一批文件。每条插件生命周期命令都会收到选定的 `DSH_HOME`。

完成首次设置后，可在“通用设置”中把活动 home 切换到本构建的独立目录、经识别的官方 `~/.dsh`、另一个经识别的现有 DSH 目录，或选择一个空文件夹创建新配置。原生目录选择器会在 Electron 原子记录目标并完整重启应用前再次验证目录。新选的空文件夹会走普通的全新安装启动流程，包括初始化 Web Profile 与安装预置插件。切换不会复制、合并、移动、覆盖或删除任何数据；各目录分别保留自己的会话、设置、Profile 与插件。启动环境显式提供 `DSH_HOME` 时此控件会禁用，因为启动环境仍拥有最高优先级。

诊断页的“插件快照”会在插件安装、更新、卸载、构建授权、隔离和修复前自动保存 Web Profile 的依赖声明、精确锁文件、有序 Bundle、`allowBuilds`、隔离状态、预置 seed 状态与导入恢复状态。它不复制 `node_modules`，也不保存或回退会话、凭据、`settings.yaml`、用户 Patch、插件业务数据、主题或背景。写入自动快照载荷前，桌面版会先比较受管文件指纹；若已有内容相同且载荷健康的回退点，就直接复用而不保存重复副本。每次客户端与事件分发均成功就绪后，当前状态会成为唯一的“最近成功启动”点；另保留最近十个不同的自动状态，手动命名快照只由用户删除。卡片常态只展示最近三个回退点，其余内容可通过展开/收起按钮查看。恢复会先创建不可淘汰的安全点，优先通过内置 pnpm 离线冻结重建并运行只读 Doctor；缓存不足时先撤销操作，再由用户明确确认联网重试。恢复后的客户端无法就绪时会自动回到安全点。Harness 完全无法进入主界面时，独立启动失败页也能直接列出和恢复这些快照。

打包版本在 `bundled-plugins/manifest.json` 中携带五个固定版本、经过完整性校验的启动预设归档，以及三个仅供诊断使用的资源。本地打包开始前，pnpm 会通过 registry 启动条目的 `latest` 稳定 dist-tag 解析版本，从 npm 官方 registry 下载 tarball，核对 registry 提供的 SHA-512，并原子替换整套快照；固定 Git 与诊断条目继续保留经过审核的归档。GitHub 打包只解析一次快照，并让所有平台复用同一组文件。Harness 启动前只预设包括 Better Sidebar 在内的五个插件，且始终把安装包内的本地归档交给 pnpm，不会从 registry 解析或下载该插件包；普通传递依赖仍由 Profile 的 pnpm store 与解析规则管理。只有诊断演练中心可以安装 `dsh-font`、`@dsh-diagnostic-lab/scoped-loader-mismatch` 和 `@dsh-diagnostic-lab/loader-dependency-unavailable`；最后一个资源用于证明“聚合 Loader 可以解析、但内部 Host 导入缺失”时仍能正确归属并隔离。配套的损坏设置场景无需另一个插件归档，会验证真实安全模式入口和设置的精确恢复。所有平台安装包都不携带 Codex 和 Claude Code：用户在“外部工具”中点击安装后，客户端才从 npm 下载经过审核的兼容版本与平台依赖，因此这一步需要联网。打包前门禁会逐项确认两个精确 Provider 版本、原生运行时坐标、所有已声明的平台包，以及经过审核的 SHA-512 都真实存在于 npm 官方 registry。另一份兼容清单通过 GitHub Actions OIDC 和 Sigstore 签名发布；已发布客户端只有在仓库、工作流、分支、in-toto 主体摘要、桌面版本线、有效期与 schema 全部匹配时才会采用。经过验证的缓存可供之后离线使用；网络、签名、有效期、身份或解析任一失败时，客户端只回退到安装包内置的精确已知可用版本。两条路径都不会跟随可变 dist-tag，也不会根据桌面版本拼接 Provider 版本。开发版使用仓库固定的 pnpm，安装版使用内置 pnpm，两者都不依赖系统 pnpm。持久种子标记在用户卸载后继续保留，因此启动不会擅自装回插件，而用户明确点击发现页或导入插件恢复操作时仍可重新安装。桌面端继续保留精确白名单的延后安装任务和进度能力，供明确的恢复流程复用，但 Better Sidebar 不再自动触发进入后的延后任务。打包不会复制开发电脑 Web profile 中已经安装或更新过的插件。

每次外部工具安装请求都会刷新签名兼容清单；同时发起的请求共享进行中的查询。后续请求可以从此前的网络失败中恢复，或在不重启桌面端的情况下采用新审核的修订版。这会选择最新的已审核兼容坐标，而不是 npm 最新发布版本，也不会静默升级已经安装的工具。发布门禁还要求记录的源码审核基线及运行时版本与工作区一致，因此合并上游后即使继续选择原有 Provider 版本，也必须重新确认兼容性。桌面端从 `https://flaqai.github.io/open-deepseek-harness-desktop/metadata/external-tools/v1/` 获取两份签名文档；发布工作流只通过 GitHub Pages 部署这些文档，没有 Release 写入权限。发布要求仓库的 Pages 来源设为 GitHub Actions，且 `github-pages` 环境允许 master 部署。本仓库的 Pages 专用于元数据；文档部署在这里被排除，避免覆盖元数据站点。使用旧 Release 地址构建的安装包仍保留该地址，需要重新打包才能切换；此工作流既不删除，也不重建旧 Release。

桌面端只为官方 Codex Provider 解析系统代理，显式代理设置优先。插件下载保留 pnpm 与 Git 自身配置，不继承面向 ChatGPT 的专用路由。网络失败会附带有长度边界的分类与耗时提示；不会仅凭环境变量推断实际路由。详见[代理作用范围与验证限制](../../.agents/notes/implemented/bug-fix/2026-09-03-desktop-codex-proxy-scope.zh.md)。

开发与打包脚本会从 Desktop 和 Web 各自的应用目录执行。每个 Unix 打包命令都会把明确的平台与架构同时传给运行时和 Codex 准备步骤，使 macOS Apple 芯片、macOS Intel、Linux x64 与 Windows x64 的 staging 相互独立。

<a id="custom-application-icons"></a>
## 自定义应用图标

输出预览包含透明留白与平滑圆角。自定义 macOS 应用图标的主体位于 512 像素画布中央的 412 × 412 区域；Windows 应用图标与自定义托盘图标使用 480 × 480 区域，保持小图标可读性。保存的裁剪图不含这些样式，启动时按固定规则生成，因此不会反复缩小。内置图标保留原有图形。macOS 开发版与安装版在启动、设置预览和恢复默认时共用默认 Dock 图片，通过减少透明边距做小幅视觉放大；调整始终从内置原图生成，不会累积。

“通用设置 → 应用图标”接受不超过 10 MB、1600 万像素的本地 PNG 或 JPEG。拖动图片或使用方向键定位方形裁剪区域，调整缩放，检查大图及深浅背景下的 16/32 像素预览，然后确认。取消与 Escape 会丢弃本次选择。裁剪区域小于 512 × 512 时显示清晰度提示。托盘图片默认跟随应用图标；关闭跟随后可单独选择图片。“恢复默认”会移除对应覆盖设置。Linux 与普通 Web 客户端不显示这些控件。

Electron 会规范化 JPEG 方向，只在 `userData/icons` 保存 512 像素 PNG、派生 ICO 帧及原子选择记录，不保留原图路径或元数据。这些文件属于当前桌面构建，不属于 `DSH_HOME`，因此切换数据目录和恢复插件快照不会切换图标。启动会在创建窗口与托盘前加载已保存图片。文件缺失或损坏时回退到内置图片，并显示修复提示，不阻断启动。

macOS 只更新运行中的 Dock 和菜单栏，不修改应用包、Finder、签名或退出后的图标。自定义菜单栏图片保留原色，内置回退图标沿用现有模板图。Windows 请求更新窗口/任务栏与托盘，同时保留 AppUserModelID。快捷方式适配器只更新当前用户桌面与开始菜单中指向本安装实例、且仍使用内置或受管图标的链接，保留启动参数和用户另行设置的图标。除非用户点击“创建本用户桌面快捷方式”，否则不会创建缺失链接。每个位置独立报告结果。固定的任务栏入口可能需要取消固定后重新固定；应用不会重启 Explorer 或清理系统缓存。Windows Shell 行为及安装版升级行为需要原生发布验收，适配器测试不能代替这些检查。

macOS 默认菜单栏图标使用[确认版骑鲸模板](../../.agents/notes/implemented/bug-fix/2026-08-20-macos-tray-template-icon.zh.md)，保留空心嘴部与向外的下颌圆弧。白色加透明通道的图形按比例缩放为横向图片，由 macOS 根据菜单栏调整显示颜色。图形独立于 Dock 图标。

## 可选终端命令

Windows 与 macOS 安装版可以注册由桌面客户端管理的 `dsh` 命令，但不会把应用私有的 npm 或 pnpm 暴露到系统环境。Windows 安装向导提供默认不勾选的当前用户 PATH 选项，“通用设置”也提供安装、检查修复和移除；静默安装只有显式传入 `/ADDCLI=1` 才会启用。macOS 由“通用设置”在 `.zprofile` 或 `.bash_profile` 中维护带固定标记的精确区块，首次修改前保留一次备份；无法识别的 Shell 只显示手动说明，不自动修改配置。

启动器始终使用应用内置的 Node、Harness 和 pnpm 路径，并在每次调用时读取 `data-home-setup.json`：导入与全新模式跟随首次设置时确认的独立 home（包括可选的自定义空文件夹目标），复用模式跟随用户选择的官方或既有 DSH home。首次目录选择尚未完成、设置文件损坏或内置运行时不完整时，命令会明确失败并提示打开客户端修复，不会静默创建另一套环境。发现其他来源的 `dsh` 时会先显示冲突，只有用户明确确认后才让客户端入口优先。卸载仅删除本应用写入的精确 PATH 条目或 Shell 标记区块。

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

安装程序写入 `.artifacts/desktop-windows/DeepSeek-Harness-windows-x64.exe`。它包含官方 Windows x64 Node 24.11.1 可执行文件、pnpm 11.7.0，以及保留真实 `node_modules` 层级且无符号链接的 Harness 生产依赖闭包，用户无需在 `PATH` 中安装 Node 或 pnpm。Harness 环境会把内置运行时放在最前面，保证包含 `%SystemRoot%`、`System32`、Wbem 与 Windows PowerShell，再保留 Electron 启动时继承的用户 PATH。因此插件可以按裸命令名启动 Windows 系统程序和已继承的第三方命令。未出现在这份继承 PATH 中的第三方工具仍不可用；客户端运行期间修改注册表 PATH 或安装新命令后需要重启应用，客户端不会执行 PowerShell profile 来发现其他命令。Electron Builder 运行前，准备脚本会校验官方 Node 归档的 SHA-256、必需的 Windows 原生模块、内置 pnpm 版本，并实际启动 Harness 等待就绪。

在 Linux 上使用下列命令构建 Linux x64 软件包：

```sh
npm run package:desktop:linux:x64
```

DEB 与 RPM 文件写入 `.artifacts/desktop-linux/`。与 macOS 相同，它们包含目标平台原生的 Node、pnpm 与 Harness 生产运行时归档。`Desktop packages` 工作流会运行四个原生任务，上传五种安装包并生成 `SHA256SUMS`。手动运行默认只保留 Actions artifact；仅从 `dsh-v*` 标签明确要求发布，或推送该标签时，才会使用固定平台文件名创建或更新对应 GitHub Release。

## 进程生命周期

Electron 主进程不经过 shell，直接启动 `node apps/cli/lib/bin.js web --host 127.0.0.1 --port 0`。所有打包平台都使用内置的目标平台原生 Node，不使用 Electron 或用户安装的 Node 可执行文件。宿主只把 `dsh web: http://127.0.0.1:<port>` 识别为就绪信号，将 stdout 和 stderr 追加到 Electron 的平台日志目录；应用退出时先发送 `SIGTERM`，超过固定期限后再发送 `SIGKILL`。默认关闭窗口只会隐藏到系统托盘；用户可以改为关闭即请求完整退出，所有显式退出都会等待 Harness 清理。启动期间，单向确定进度条只按桌面环境、内置运行时、Profile 兼容性、预设插件与 Harness 的真实里程碑前进，同时显示当前操作和插件名称；Harness 就绪时达到 100%，随后才把窗口交给 Web GUI。Harness 数据目录尚未确定时，目录选择页跟随系统外观；完成选择后，持久化的 `ui-theme.preference` 会通过同一个 `system`／`light`／`dark` 来源同步加载页、原生边框、自定义顶栏、首次引导和 Web 主界面，并在用户切换主题时继续更新。Harness 在就绪前连续退出三次后会停止自动重启，并显示重试与日志操作。连接页等待十五秒后也会显示同一个固定日志入口，但不会把缓慢启动判为失败。

托盘可以恢复窗口、定位 Harness 日志、切换通知、启用已打包 macOS 的登录启动或退出。崩溃、最终启动失败和恢复通知均可关闭并按事件节流。桌面偏好以原子方式存入以仓库名命名的 Electron `userData`；非法字段会各自恢复安全默认值。

可通过 `DSH_DESKTOP_DSH_BIN` 测试其他已构建的 `dsh` 启动文件。若 Electron 继承的环境无法找到 `node`，可设置 `DSH_DESKTOP_NODE_BIN`。

## 官方源码更新

用户确认后，升级器快进工作树，通过桌面 Harness 所选的 Node 可执行文件运行 `pnpm install --frozen-lockfile`，再执行完整仓库构建。依赖安装与构建子进程不会继承名称包含凭据特征的环境变量。准备失败时，升级器把工作树重置到原提交并重新准备该版本；如果恢复失败，结果会明确报告回退不完整，而不会把旧构建显示为健康状态。升级成功后需重启应用，设置卡片会提供该操作。

只有在测试另一个可信工作树时才设置 `DSH_DESKTOP_SOURCE_ROOT`。没有 Git 工作树的安装包不会运行该升级器；安装包自动更新仍以签名发布元数据和可用回退为前提。

## 打包版本的 Release 发现

打包应用会在启动后、运行期间每六小时以及用户明确请求时检查 `https://github.com/flaqai/open-deepseek-harness-desktop` 的 Releases，并识别社区 `odsh-v*`、旧版 `dsh-v*` 和普通 `v*` 标签。标为 GitHub pre-release 的 Release 始终被排除，因此把有问题的 Release 从 Latest 改为 pre-release 后即可从应用内更新发现中撤回。在保持正式发布状态的 Release 中，稳定版会依据语义版本忽略预发布标签，即使 GitHub 元数据标记错误也不会接受；预发布客户端可以发现任意更高的语义预发布或稳定版本。手动 Release 请求超过十五秒后会显示明确错误，不会让设置页一直停留在检查状态；后台网络失败会保留已经发现的更新，不会显示短暂错误。发现可用版本时，设置窗口右上角会显示紧凑徽标，同时继续在“通用设置”中显示版本状态。支持的 macOS 和 Windows 安装版可以下载并校验所选安装程序，其他目标则会在系统浏览器中打开经过仓库校验的 Release 页面。

## 安全性

渲染进程使用 `nodeIntegration: false`、`contextIsolation: true` 和 `sandbox: true`。导航仅允许 Harness 进程对应的精确回环来源。新开的 HTTPS 窗口交给系统浏览器，其余新窗口全部拒绝。除受监管 Harness 来源的主框架发起的安全剪贴板写入外，渲染进程的权限请求全部拒绝；剪贴板读取和其他所有权限仍保持拒绝。因此，共用客户端可直接使用标准 Web Clipboard API，而不必暴露通用的高权限 Electron bridge。

API 密钥仍由 Harness credentials 服务持有。可选的首次导入只会把凭据文档作为不透明用户数据复制到独立 home；不会解析、显示、记录或删除来源。直接复用则是用户明确选择让桌面版就地使用官方 credentials 服务。沙箱 preload 在源码运行中暴露类型化源码更新调用，并提供桌面能力、偏好更新、固定日志定位、Release 发现、安装包归档精确白名单，以及桌面端拥有的导入插件恢复清单与插件快照中的不透明 id。Electron 从经过验证的本机记录解析恢复说明符和快照文件；渲染层只能提交快照 id、有限名称与联网确认，不能提交包说明符、命令、路径或文件内容。其他任意包名仍必须经过受保护的 Harness 插件服务。Release URL 仅限本仓库，渲染进程不能提供文件路径。在 Windows 和 Linux 上，preload 还会渲染桌面宿主自有标题栏，并将固定的最小化、最大化或还原、关闭意图直接发送给主进程。它不暴露通用命令、文件系统、URL 打开或下载方法。

Profile 插件属于可信的可执行代码。内置包管理运行时让插件的 pnpm 生命周期脚本使用确定的工具版本，但不会对从 registry、Git 仓库、tarball 或本地 checkout 安装的代码提供沙箱或背书。

<a id="cross-platform-release-matrix"></a>

## 跨平台发行矩阵

源码宿主只使用 macOS、Windows 和 Linux 共用的 Electron 与 Node 进程 API。macOS 保留原生标题栏与交通灯按钮；Windows 和 Linux 使用无系统边框 BrowserWindow，其渲染器只承载 36 px 可拖拽标题栏及最小化、最大化或还原、关闭按钮。独立的 `WebContentsView` 从 `y = 36` 开始加载启动页、Harness 和所有插件，因此内容视口天然排除桌面 chrome，全视口 Web 内容也无法渲染到窗口按钮下方。打包工作流会在匹配的原生运行器上构建以下矩阵：

| 平台 | 原生运行器 | 产物 |
| --- | --- | --- |
| macOS arm64 | `macos-15` | DMG 与 ZIP |
| macOS x64 | `macos-15-intel` | DMG 与 ZIP |
| Windows x64 | `windows-2025` | NSIS EXE |
| Linux x64 | `ubuntu-24.04` | DEB 与 RPM |

Windows 任务会把最终 NSIS 产物静默安装到包含空格和中文字符的路径，检查安装后的运行时，使用隔离的应用数据启动已安装程序，并在上传产物前要求 Harness 输出就绪行，同时确认六个启动预设的依赖、bundle 条目、Profile 锁文件和持久化 seed 标记均已生成。Better Sidebar 必须在 Harness 就绪前完成安装，而 Codex 与 Claude Code 在用户操作前必须保持未安装。其他平台仍需完成原生安装、首次启动、退出、子进程清理、目录选择、文件打开、PTY 与沙箱行为的发布验证。只有在发布签名与回滚可用后才添加已签名的更新元数据。

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
