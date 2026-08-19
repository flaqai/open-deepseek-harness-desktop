# Agent Note：可卸载的内置预设插件

状态：已实现

[English](2026-08-18-removable-bundled-plugin-market.md) | 中文

## 问题

桌面安装包应离线提供选定的默认 Web 插件，同时每个插件仍是用户可卸载的普通 profile 依赖。若写入核心 Cordis bundle，启动会把它们恢复。

## 决策

Electron 资源携带固定 tarball 及其 SHA-512 完整性，分别对应 `dshmarket@1.12.1`、`@xmanrui/dsh-im@0.11.0` 和 `dsh-skill-picker@0.2.0`。打包应用首次启动时会校验每个缺失种子、将其复制到 DSH home，再使用安装包内 Node 与 pnpm 调用既有 CLI 安装器。安装成功或发现已有同名软件包依赖后，会写入该插件的持久种子标记，且不会替换已经安装的版本。

每个标记都会在 profile 移除后保留，因此后续启动不会自动重装对应插件。种子安装失败时不会写入标记，也不会阻止其余条目继续播种。Windows 包含 pnpm 和收窄的 Electron-as-Node 命令包装。Host 提供精确包名 `startUninstall`；插件列表 React 组件通过 slot 注入接收它，并且只对 `dshmarket` 显示专用的自移除操作。三个插件仍都是普通依赖，可以通过标准 profile 插件管理器移除。

## 考虑过的替代方案

- **核心 Web bundle：** 拒绝，因为无法独立卸载。
- **缺失就重新预装：** 拒绝，因为会撤销用户卸载。
- **插件自卸载：** 拒绝，因为插件无法可靠移除自身正在活动的软件包和 bundle。
- **Windows 系统 Node 与 pnpm：** 拒绝，因为安装包必须自包含。

## 影响

macOS、Windows 与 Linux 安装包携带三个经过审计的归档。首次启动时，每个缺失种子都可能运行一次本地包管理操作。市场的设置操作与普通 CLI 移除使用相同的 profile 路径，重启后生效。测试固定完整 manifest、归档完整性、已有版本接管、标记行为、Windows 包装、Host 卸载和确认界面。
