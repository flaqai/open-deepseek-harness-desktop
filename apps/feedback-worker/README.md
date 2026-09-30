# Community feedback receiver

English | [中文](README.zh.md)

## Summary

The Cloudflare Worker stores community feedback in D1 and sends one daily summary to `odsh_hecoococ@163.com`. The Desktop About page provides this form, email and GitHub Issues. In-app submission is disabled until the deployed receiver and email configuration pass operator verification.

## Table of Contents

- [Request and storage](#request-and-storage)
- [Deployment configuration](#deployment-configuration)
- [Delivery and retention](#delivery-and-retention)
- [Known limitations](#known-limitations)

<a id="request-and-storage"></a>
## Request and storage

`POST /v1/feedback` accepts only type (`bug`, `idea`, `other`), title, body, optional reply email, request UUID, desktop version and OS. Titles contain 3–120 characters; bodies contain 10–4000 characters. Requests larger than 20 KiB are rejected. Desktop never attaches logs, screenshots, sessions or credentials. A `202` response with an ID means D1 saved the report; it does not promise operator action or a reply.

The rate-limit binding permits ten submissions per minute per connecting IP and Cloudflare location. Shared networks can share this limit. An atomic insert limits the database to 10,000 new records per UTC day. Retrying the same request UUID returns its existing receipt. Storage or limiter failure returns `503`; limits return `429` with a retry interval. The receiver does not store IP addresses.

`GET /v1/admin/feedback?cursor=<id>` exports up to 100 records after the cursor. It requires `Authorization: Bearer <ADMIN_TOKEN>` with a secret of at least 32 characters. Keep this token outside the desktop build. Exports contain user-authored text and optional email addresses; operators control access and retention of downloaded copies.

<a id="deployment-configuration"></a>
## Deployment configuration

The receiver is not deployed or verified in this checkout. `wrangler.jsonc` defines D1, the rate-limit binding, the daily Cron Trigger and an email binding restricted to the community mailbox. Replace the D1 ID and sender placeholder, apply `schema.sql`, and configure `ADMIN_TOKEN` as a Worker secret in the authorized deployment environment.

The sender domain and destination mailbox must be verified according to [Cloudflare email configuration](https://developers.cloudflare.com/email-service/configuration/send-bindings/). Before enabling submission, an operator must verify the deployed HTTPS endpoint, D1 receipt, protected export, daily email delivery and retention cleanup. Then set `COMMUNITY_FEEDBACK_ENDPOINT` in the [desktop host](../desktop/src/community-feedback.ts) to that fixed HTTPS `/v1/feedback` URL and rebuild Desktop. The renderer cannot supply a destination. Runtime environment overrides are not accepted.

<a id="delivery-and-retention"></a>
## Delivery and retention

The daily trigger runs at 02:00 UTC. It deletes records older than 90 days, summarizes unnotified records by type, and sends at most 50 titles with receipt IDs through Cloudflare Email Service. The protected export contains full reports. A fixed record ID boundary keeps reports received during delivery pending for the next summary. A failed send keeps covered records pending and does not delay retention cleanup.

<a id="known-limitations"></a>
## Known limitations

The anonymous endpoint has no user account requirement; rate limits reduce abuse but do not prove sender identity. Rate limits are approximate and local to Cloudflare locations. A successful email send followed by a failed database update can repeat a summary; receipt IDs identify repeated reports. Closing the settings page discards the unsent draft. Remote service availability and real mailbox delivery require deployment verification; local tests use simulated bindings.
