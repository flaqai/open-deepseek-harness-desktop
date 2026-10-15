---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-15-nas-device-principal

[English](2026-10-15-nas-device-principal.md) | 中文

## 概述

为用户消息来源增加 NAS 设备主体归属。同一可选来源元数据出现在 user/message、developer/message、agent/inbox/spliced 和 session/title-llm-request 中。保持 Session 格式 v4。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-15-nas-device-principal
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "d50f42c2267691719042a831dfcba163ef975c20a578a2c2f12aabc1a230398b"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "81429146fbf4daac37257eb2d360db77a83a4a417c118d4cfeab9418408ffe75"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "70c0983333d696d1689f211aad2e8b7a5c864a05382ea7a173b73bf0abb37f30"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "cca4be11b50a9ce23c04a6eed81754847b3b48afe1e26a1acacdf1cc259fc978"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

历史记录中缺少主体的来源及显式 owner 来源保持原有含义。NAS 设备归属是可选历史元数据，不是保存的授权凭据：实际权限由实时 Peer 和凭据策略决定。未修改的当前 v4 读取器接受并保留 NAS 及未知未来归属，不会将其提升为 owner，因此采用同版本元数据扩展。此结论不代表每个具有封闭应用 codec 的旧 SDK 或二进制都能接受新增联合类型。不重写冻结历史格式或用户源文件；已知 v0 summary 拒绝保持不变。

<a id="verification"></a>
## 验证

session-format-catalog 的 current.spec.ts 恢复套件六项测试通过，覆盖缺省、owner、NAS 和未知未来主体经过真实当前格式恢复路径；验证来源保留及输入 JSON 不变。读取器实现相对固定 alpha.3 标签没有社区改动。独立实时 NAS 权限测试验证任务所有权及伪造授权回复拒绝；历史归属不替代这些检查。上述测试不构成旧二进制或跨平台安装客户端兼容性验收。

<a id="dev-note"></a>
## 开发备注

无。
