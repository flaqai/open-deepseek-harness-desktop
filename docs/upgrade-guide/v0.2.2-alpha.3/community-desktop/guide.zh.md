---
kind: upgrade-guide
description: "社区桌面 alpha.3 的配置、任务备份及可选功能迁移。"
---

# 社区桌面 alpha.3 升级

[English](guide.md) | 中文

## 变更

桌面开发版本跟随官方 alpha.3。共享右键菜单保留已有会话与工作区操作，社区设置分组、缩放、审批解释及侧栏文档预览继续可用。手机导航采用官方实现。本次集成不发布安装包。

文件系统观察策略跟随上游默认关闭；沙箱限制与 Review 保留。已有显式 profile 覆盖保持原值。除非部署显式启用，`apply_patch` 仍保持关闭。配置见[文件系统默认值迁移](../../v0.2.2-alpha.2/fs-observation-policy-default-off/guide.zh.md)。

## 迁移

自动化任务采用宿主级统一管理。NAS 任务管理请求仍仅限管理员。首次写入并把任务存储升级到版本 2 前，存储后端保留持久备份；仅读取不会升级数据。旧客户端不能读取版本 2。仅在应用停止后按[任务备份说明](../../../../packages/schedule/schedule/README.zh.md)恢复；SQLite 备份恢复整个数据库，包括快照时点的其他单元。

web 或 shared profile 中显式配置的旧 `@deepseek-ai/dsh-experimental-tool-worktree` bundle 会产生桌面诊断及备份，不改写源配置。检查备份后手动移除旧项；如有需要，再单独启用“变更请求与工作树”。备份失败会产生独立警告：编辑前先保留手动备份。替代功能不会自动启用。

macOS Computer Use 使用自己完整的权限应用。原先授予终端或桌面客户端的权限不能证明该应用已获授权。该功能保持可选，启用时按指引授权，并显式替换不再支持的裸二进制 helper 覆盖。Python 与 Office 部署策略不变。

**验证限制**

开发检查不代表具备发布资格。手机键盘与横竖屏、Windows 与 Linux 安装、另一 macOS 架构、真实 Computer Use 授权、签名与公证，以及断网最终安装包的文档预览，需要在发布前完成对应的原生验收。
