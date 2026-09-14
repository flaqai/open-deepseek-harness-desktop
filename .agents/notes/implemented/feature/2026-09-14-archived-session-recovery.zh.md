# Agent Note: 已归档 Session 恢复

Status: implemented

[English](2026-09-14-archived-session-recovery.md) | 中文

## Problem

归档会把 Session 从导航中隐藏，同时保留其历史与 Workspace 记账，但产品没有提供查找或恢复这些保留数据的入口。用户要撤销普通的整理操作时，只能手工修改持久 Workspace 状态。

## Decision

Workspace registry 提供幂等的 `unarchiveSession()` 变更：它只从持久归档集合移除一个 id，不修改 Session 文件或 Workspace 成员关系。Workspace Remote 合约与 Client model 暴露相同变更，并安装 Host 返回的完整归档集合。

Workspace UI 在设置中注册**已归档会话**栏目。该页面读取现有 Session 与 Workspace 投影，按保留的 Workspace 分组归档项，支持按标题/id 搜索和按 Workspace 筛选，并可恢复单条 Session 或完整归档集合。恢复失败会留在页面中，以可重试反馈呈现。该页面有意不提供永久删除操作。

## Alternatives considered

**把归档视为永久操作。** 未采用，因为归档属于整理操作，而保留的 Session 数据与 Workspace 位置已让恢复具备安全且明确的语义。

**把恢复的 Session 移到未分组。** 未采用，因为 Workspace registry 会在归档期间保留成员关系；丢弃该位置会让恢复产生数据损失。

**在恢复旁加入永久删除。** 未采用，因为不可逆的 Session 删除需要独立的数据生命周期合约、确认设计和恢复边界。

## Consequences

- 用户可以从设置导航恢复归档历史，无需编辑文件。
- 恢复只改变归档集合；Session 内容、凭据与 Workspace 记账保持不变。
- 即使页面处于筛选状态，批量恢复仍作用于完整归档集合。
- 在设计出明确的删除合约前，永久删除继续保持不可用。
