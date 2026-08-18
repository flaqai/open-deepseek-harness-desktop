# Agent Note：可卸载的内置插件市场

状态：已实现

[English](2026-08-18-removable-bundled-plugin-market.md) | 中文

## 问题

桌面安装包应离线提供插件市场，同时它仍是用户可卸载的普通 profile 依赖。若写入核心 Cordis bundle，启动会把它恢复。

## 决策

Electron 资源携带固定的 `dshmarket@1.12.1` tarball 和 SHA-512 完整性。打包应用首次启动时校验归档、复制到 DSH home，再使用安装包内 Node 与 pnpm 调用既有 CLI 安装器。安装成功或发现已有市场依赖后写入持久种子标记。

该标记会在 profile 移除后保留，因此后续启动不会自动重装。安装失败时不写标记。Windows 包含 pnpm 和收窄的 Electron-as-Node 命令包装。Host 新增精确包名 `startUninstall`；插件列表 React 组件通过 slot 注入接收它，并只对 `dshmarket` 显示。

## 考虑过的替代方案

- **核心 Web bundle：** 拒绝，因为无法独立卸载。
- **缺失就重新预装：** 拒绝，因为会撤销用户卸载。
- **市场自卸载：** 拒绝，因为市场不能卸载自身。
- **Windows 系统 Node 与 pnpm：** 拒绝，因为安装包必须自包含。

## 影响

macOS 与 Windows 安装包新增一个审计归档。首次启动可能运行一次本地包管理操作。设置界面通过与 CLI 相同的 profile 路径移除市场，重启后生效。测试固定了完整性、已有版本接管、标记行为、Windows 包装、Host 卸载和确认界面。
