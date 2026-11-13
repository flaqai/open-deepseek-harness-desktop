---
description: "在不改写已发布历史的前提下合并重试输入与 NAS、LiveShare 归属元数据。"
kind: persistence-change
---

# 2026-11-12-retry-principal-merge

[English](2026-11-12-retry-principal-merge.md) | 中文

## 概述

合并官方重试输入与社区 NAS、LiveShare 归属历史。四个事件根保留 retry、user 调用方元数据，owner、NAS、share-viewer principal，以及可选的子代理结算停止原因。会话格式维持 v4。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发者说明](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-12-retry-principal-merge
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-27-retry-control-input"
    mergedPrevious: ["2026-10-28-nas-liveshare-principal-merge"]
    after: "d970ef46142e411c6b3e4915eef548a2b5da132fa67dad7106e4920ff4a7ba23"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-27-retry-control-input"
    mergedPrevious: ["2026-10-28-nas-liveshare-principal-merge"]
    after: "675f1fb72388661aef0f084985d3f9a71f5ab37fcd6462df75e3a7852ab8f33e"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    mergedPrevious: ["2026-10-28-nas-liveshare-principal-merge"]
    after: "a064a7135f4f1dc159323d96f9e439cc63a569bd02f08a69b347937d4dc62e3d"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    mergedPrevious: ["2026-10-28-nas-liveshare-principal-merge"]
    after: "5c752a1b8120d97b336e4bc549298e3d7440d6485b141a64c858231b2e4224bf"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

两个父记录及冻结格式保持不变。在新读取器读取旧数据的方向，历史用户消息、排队输入及标题输入保留原始 source 元数据，不要求重试元数据。在旧读取器读取新数据的方向，既有生产方自有 source 契约保留未知的非空 kind 和任意 JSON 归属信息，包括 retry、NAS principal 与可选结算字段。双向结构比较仍报告需要审核的联合类型变化；本记录确认审核，不屏蔽差异。旧界面可能展示空的重试上下文行。归属信息不代表授权：实时设备与共享策略仍负责权限，未知的持久化 principal 不授予 owner 权限。不改写源日志；本确认不代表旧二进制通过验收，也不解决已知 v0 摘要拒绝问题。

<a id="verification"></a>
## 验证

合并快照从当前源码重新提取。历史检查必须接受两条父链，并为四个根分别得出唯一最终节点。快照测试保留父记录字节和摘要，并比较两个读取方向，不隐藏需要审核的差异。原生持久化测试以读、写方式打开普通及 Zstd 日志，保留携带三种 principal 的 retry、user source 元数据，且源文件字节不变。原生安装客户端与历史二进制验收另行进行。

<a id="dev-note"></a>
## 开发者说明

无。
