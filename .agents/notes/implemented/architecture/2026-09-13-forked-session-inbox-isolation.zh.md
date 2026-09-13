# Agent Note: Forked session inbox isolation

Status: implemented

[English](2026-09-13-forked-session-inbox-isolation.md) | 中文

## Problem

Session fork 会保留截至完整轮次以及随后独立事件的连续事件前缀。该前缀中的 `agent/inbox/spliced` 事件可能表示排入 parent 下一轮的提示词。如果把该事件回放为活跃的 child 状态，child 的第一轮会先领取 parent 的排队提示，再处理在 child 中提交的提示词。

## Decision

Inbox 投影在内部状态中记录 Session 的 `inheritedEventCount`，并忽略序号低于该偏移量的继承 inbox splice。这些事件仍保留在 child 日志中，因此历史和序号来源保持完整。偏移量处及之后的 inbox splice 归 child 所有，并会在恢复后继续保持待处理状态。

Inbox 投影使用 `stateVersion: 2`。持久化的版本 1 投影行会被丢弃，并按照 fork 隔离规则从 Session 日志重新构建，因此陈旧缓存无法恢复从 parent 继承的工作。

## Alternatives considered

**在 `turn/end` 处结束 fork 前缀。** 这会移除排队提示，但也会丢弃 fork 操作有意在完整轮次后保留的无关独立状态。

**删除或改写继承的 inbox 事件。** 这会破坏来自 parent 的精确连续前缀，并使 child 日志与记录的继承事件数量不一致。

## Consequences

普通 fork 会继承对话历史，但绝不继承 parent 的待处理工作。多层 fork 遵循相同规则。恢复的 child 只恢复自身的待处理输入。聚焦的 AgentLoop 与 Session Controller 测试覆盖直接 fork 路径、多层 fork、恢复和版本 1 缓存失效。
