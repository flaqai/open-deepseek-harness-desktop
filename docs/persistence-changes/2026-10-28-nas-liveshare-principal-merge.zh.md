---
description: "在不改写两条已发布历史的前提下合并 NAS 与 LiveShare 归属元数据。"
kind: persistence-change
---

# 2026-10-28-nas-liveshare-principal-merge

[English](2026-10-28-nas-liveshare-principal-merge.md) | 中文

## 概述

合并 NAS 设备与 LiveShare 查看者的并行归属历史。四个事件根的可选 principal 词汇同时保留 owner、NAS 设备及 share-viewer 归属；会话格式维持 v4。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发者说明](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-28-nas-liveshare-principal-merge
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    mergedPrevious: ["2026-10-15-nas-device-principal"]
    after: "536aef107ab874332804d77b3d19fe4ed23ef4768c8ff34eb3311d46fde99c1f"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    mergedPrevious: ["2026-10-15-nas-device-principal"]
    after: "d9341ae94bda33eb37b5cd15b13f061865c9c8cb98c72cc2c3ccd771c3ba6b59"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    mergedPrevious: ["2026-10-15-nas-device-principal"]
    after: "1d062eda1c71c392cb9a61bb16a45e8cda4f77064b18db993ebb320b5eaafa04"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    mergedPrevious: ["2026-10-15-nas-device-principal"]
    after: "6b0fdfd57aa02edbb77bf2dd715105734ad689f788f6fe6b7981a848d50bfe44"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

两个父记录保持不可变。合并记录独立确认每条父转换。源 principal 元数据记录归属而非授权：实时 NAS 设备及 share-viewer 策略仍负责访问控制。缺失及未知历史归属继续保留，且不会授予 owner 权限。不改写源会话日志或冻结格式定义。本确认不代表旧二进制兼容性或已知 v0 摘要拒绝问题已经通过验收。

<a id="verification"></a>
## 验证

合并后 schema 从当前源码提取。持久化历史检查必须接受两条父路径，并要求唯一的最终节点；解码测试覆盖保留的两份内联父快照、摘要不匹配拒绝及源文件字节不变。NAS 与 LiveShare 协议测试验证独立的实时权限策略。原生安装客户端及跨平台验收另行进行。

<a id="dev-note"></a>
## 开发者说明

无。
