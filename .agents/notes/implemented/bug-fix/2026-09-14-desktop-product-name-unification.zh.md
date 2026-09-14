# Agent Note：统一桌面产品名称，同时保持应用身份不变

状态：已实现

[English](2026-09-14-desktop-product-name-unification.md) | 中文

## 问题

源码开发版、安装版可执行文件、菜单、标题栏、快捷方式和全新安装目录分别使用了 `DeepSeek Harness`、`Open DSH Desktop` 与 `deepseek-harness`。因此，用户会因启动或安装方式不同而看到不同的应用或进程名称。

## 决策

将 `Open DeepSeek Harness Desktop` 作为唯一规范的用户可见产品名。macOS、Windows 和 Linux 的 Electron Builder 均使用它作为 `productName`；运行时应用名、默认窗口标题、原生菜单文案、自定义标题栏、加载页品牌、Windows 快捷方式创建和安装包冒烟检查也统一使用完整名称。渲染器报告的通用标题 `DeepSeek Harness` 会映射为桌面产品名，具体对话标题则保持不变。

macOS 源码启动器仍复制并 ad-hoc 签名项目专用 Electron 包，复制出的 `.app`、Bundle 显示名和运行时进程标题使用规范产品名。内部开发可执行文件保留为 `Electron`，以维持 Electron 的 `process.defaultApp` 与 `app.isPackaged` 开发模式判定；将其重命名会让源码开发版误走安装包运行时解压路径。缓存键包含产品身份，避免继续复用旧的已就绪包装。共享 Electron 安装、Bundle 标识和 Helper 布局不变；macOS 安装版主可执行文件和 Helper 继续由 Electron Builder 根据 `productName` 生成名称。

Windows 全新安装从完整产品名生成可执行文件和默认安装目录。原地升级的已有安装可能继续保留 NSIS 先前记录或用户选择的目录；应用不会在升级时移动现有安装目录。Linux 的可执行文件采用 `open-deepseek-harness-desktop`，因为命令名不使用展示名称中的空格。

稳定技术身份保持不变，包括 `ai.flaq.deepseek-harness`、`open-deepseek-harness-desktop` 用户数据归属、既有 Linux 软件包身份、更新元数据和 Release 资产文件名，以保留 Profile 发现、应用升级、卸载和下载兼容性。

## 考虑过的替代方案

**重命名所有技术标识。** 仓库 slug、应用数据目录、Linux 软件包身份和 Release 文件可以在视觉上完全一致，但可能产生并行安装、升级识别失效、用户数据不可访问及更新选择中断。

**只修改窗口标题。** Activity Monitor、任务管理器、`.app`、`.exe`、快捷方式和全新安装目录仍会显示不一致的名称。

**macOS 继续使用短名称 `Open DSH Desktop`。** 平台专属简称会再次造成原问题，也会让支持截图和进程诊断产生歧义。

## 影响

新的源码包装和安装版应用会一致显示完整产品名。macOS 开发包装内部仍包含名为 `Electron` 的启动文件，这是开发模式识别所需的实现细节，不作为面向用户的应用名或进程标题。Windows 现有安装原地升级后，目录路径可能继续保留旧名称，直到用户选择新位置或全新安装；这是有意的兼容行为，不代表重命名失败。代理基准测试辅助脚本仅为测试已发布旧版本而继续识别旧 macOS 应用路径。

## 验证

单元测试覆盖规范原生菜单文案、渲染器标题映射和 Windows 快捷方式命名。打包配置和冒烟测试核对新的 macOS、Windows 可执行文件名以及 macOS Helper 布局。Desktop TypeScript、Desktop 构建、定向测试、文档门禁和空白检查覆盖源码集成。Windows、Linux 和最终 macOS 安装包的真实进程名仍需在对应发布平台验收。
