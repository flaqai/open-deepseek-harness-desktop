# Agent Note：流式 Client 按帧发布

Status: implemented

[English](2026-09-13-streaming-client-frame-publication.md) | 中文

## Problem

Assistant stream frame 的到达速度可能超过显示器的绘制速度。Client event feed 已经延迟 Conversation 渲染，但每条瞬态 frame 仍会在微任务中把完整 Session snapshot 标记为 dirty。推送的 projection value 也使用同一条微任务路径，导致 Session Manager 反复重建列表行。一次突发输入因此会为屏幕无法展示的中间状态执行订阅与 snapshot 工作。

## Decision

瞬态 Assistant frame 将 Session snapshot 标记为 frame-dirty。Projection control frame 将逐 key 与 any-key 通道标记为 frame-dirty。每个通道每个动画帧最多发布一次最新累计状态。Projection baseline 与 truncate 继续使用结构微任务发布，Assistant settlement、生命周期、queue、prompt 和受控输入更新也保持原有时序。

Event feed 仍同步接收每条 Assistant frame。这样可以保留密集 index 校验、顺序、settlement 匹配和完整瞬态 fold，同时删除外层 Session 与列表的重复发布。

## Alternatives considered

**停用流式显示或减少模型输出。** 这会隐藏有用进度并改变产品行为，而不是删除 Client 的重复工作。

**限制所有 Session 变更的发布频率。** 用户操作、持久 settlement、生命周期转换、baseline 和恢复操作需要及时发布。对全部变更使用动画帧节奏会削弱这些时序要求。

**修改平滑渲染插件。** 重复发布位于所有组合共用的 Client 对象层。第三方渲染可能增加工作量，但不拥有 Session 或 projection 的通知时序。

## Consequences

突发 token 输入在每个显示帧内只产生一次外层 Session 通知，并为每个已订阅 projection 通道产生一次通知。消费者仍会取得最新累计值，结构状态也能取代尚未执行的帧发布。本次变更不合并 transport frame，也不跳过校验。测试固定了突发合并、陈旧 projection 拒绝和结构发布取代帧发布的行为。
