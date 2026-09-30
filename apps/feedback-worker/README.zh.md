# 社区反馈接收服务

[English](README.md) | 中文

## 概述

Cloudflare Worker 把社区反馈保存到 D1，每天向 `odsh_hecoococ@163.com` 发送一份摘要。Desktop 的“关于”提供此表单、邮件与 GitHub Issues 入口。部署后的服务和邮件配置通过维护者验证前，应用内提交保持关闭。

## 目录

- [请求与存储](#request-and-storage)
- [部署配置](#deployment-configuration)
- [投递与保留](#delivery-and-retention)
- [已知限制](#known-limitations)

<a id="request-and-storage"></a>
## 请求与存储

`POST /v1/feedback` 只接受类型（`bug`、`idea`、`other`）、标题、正文、可选回复邮箱、请求 UUID、桌面版本和操作系统。标题为 3–120 个字符，正文为 10–4000 个字符；请求超过 20 KiB 时拒绝。Desktop 不自动附带日志、截图、会话或凭据。带 ID 的 `202` 响应表示 D1 已保存报告，不承诺维护者处理或回复。

限流绑定按连接 IP 和 Cloudflare 节点允许每分钟十次提交；共享网络可能共用限额。原子插入把数据库每天新增记录限制为 10,000 条，按 UTC 日期计数。重试同一请求 UUID 会返回已有回执。存储或限流服务故障返回 `503`；超限返回 `429` 并提供重试间隔。接收服务不保存 IP 地址。

`GET /v1/admin/feedback?cursor=<id>` 导出游标后的最多 100 条记录，需要 `Authorization: Bearer <ADMIN_TOKEN>`，Secret 至少 32 个字符。此令牌不能进入桌面构建。导出包含用户填写的正文与可选邮箱；维护者负责下载副本的访问控制与保留期限。

<a id="deployment-configuration"></a>
## 部署配置

此工作区中的服务尚未部署或验证。`wrangler.jsonc` 定义 D1、限流绑定、每日 Cron Trigger，以及只能发送到社区邮箱的邮件绑定。在已授权的部署环境中替换 D1 ID 和发信地址占位值，应用 `schema.sql`，并将 `ADMIN_TOKEN` 配置为 Worker Secret。

发信域名和收件邮箱必须按 [Cloudflare 邮件配置](https://developers.cloudflare.com/email-service/configuration/send-bindings/)完成验证。开放提交前，维护者需要验证部署后的 HTTPS 接口、D1 回执、受保护导出、每日邮件投递和到期清理。随后将[桌面宿主](../desktop/src/community-feedback.ts)的 `COMMUNITY_FEEDBACK_ENDPOINT` 设置为固定 HTTPS `/v1/feedback` 地址并重新构建 Desktop。渲染层不能指定接收地址；不接受运行时环境变量覆盖。

<a id="delivery-and-retention"></a>
## 投递与保留

每日任务在 UTC 02:00 运行，删除超过 90 天的记录，按类型统计尚未通知的记录，并通过 Cloudflare Email Service 发送最多 50 个标题及回执 ID。受保护导出提供完整报告。固定记录 ID 边界让投递期间收到的反馈保留到下一次摘要。发送失败时，相关记录仍等待通知，到期清理继续执行。

<a id="known-limitations"></a>
## 已知限制

匿名接口不要求用户账号；限流减少滥用，但不能证明发送者身份。限流近似统计，且只在对应 Cloudflare 节点生效。邮件发送成功后数据库更新失败，可能重复发送摘要；回执 ID 可识别重复报告。关闭设置页会丢弃未发送草稿。远程服务可用性和真实邮箱投递需要部署验证；本地测试使用模拟绑定。
