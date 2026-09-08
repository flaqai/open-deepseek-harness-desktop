# Agent Note: macOS Helper 名称与原生安装包验证

Status: implemented

[English](2026-09-08-macos-helper-name.md) | 中文

## Problem

Electron 在加载 JavaScript 前根据 CFBundleName 解析原生 Helper 路径。显示品牌覆盖值如果与打包的 Helper 名称不同，即使 ad-hoc 签名有效，也会因 SIGTRAP 中止启动。

## Decision

macOS 安装包保留 electron-builder 自动生成的 CFBundleName，显示品牌使用 CFBundleDisplayName。打包工作流检查每个最终 DMG 和 ZIP 内的 Helper 可执行文件路径及签名，随后在上传前运行有超时限制的原生就绪探针。专用入口仅在正常启动时导入桌面宿主；探针等待 Electron 就绪后退出，不创建 Profile。

## Alternatives considered

**单独重命名 Helper。** 这会在签名前增加多个可执行文件与 plist 修改。保持构建器生成的名称一致可以避免这些额外转换。

**仅依赖签名、校验值或 --version。** 签名和校验值可以接受结构有效但无法启动的应用。打包应用可能忽略 --version 并启动完整宿主，因此原生探测需要显式入口。

## Consequences

两个原生 macOS runner 都会在接受发行资产前拒绝名称不匹配。探针将原生启动与用户配置分开，但不证明 Harness 或界面健康；完整应用就绪仍是单独的发布验证。
