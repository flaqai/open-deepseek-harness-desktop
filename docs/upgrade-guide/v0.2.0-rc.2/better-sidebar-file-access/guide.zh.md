---
kind: upgrade-guide
description: "预装的 Better Sidebar 文件路由不再限定于所选工作区。"
---

# Better Sidebar 文件路由不再强制工作区范围限制

[English](guide.md) | 中文

## 变更

桌面端预装的 `dsh-better-sidebar` 从 0.22.1 更新到 0.24.1，以兼容 DSH 0.2.0。新版移除了 `workspaceFence` 设置及文件路由对所选工作区的检查。只要运行 Harness 的操作系统用户有权限，插件就能读取或修改工作区以外的文件。这影响新建的桌面托管 Profile，以及桌面自有 seed 被升级的现有 Profile；用户明确选择的版本保持不变。

## 迁移

1. 如果此前依赖 `workspaceFence`，不要再把所选工作区当作访问限制。`$DSH_HOME/settings.yaml` 中 `dsh-better-sidebar` 下的旧字段可以保留，但已不起作用；建议移除，避免误判。
2. 在升级后的插件处理不可信内容前，使用文件系统权限仅覆盖目标路径的操作系统账户或沙箱运行 Harness；否则在 Profile 中停用 Better Sidebar。
3. 确认 Profile 使用 `dsh-better-sidebar@0.24.1`，并检查运行账户对工作区以外路径的访问权限。插件不会仅因路径位于工作区之外而拒绝访问。
