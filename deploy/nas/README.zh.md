# NAS 部署（预览）

[English](README.md) | 中文

此 Compose 方案在 NAS 上运行 Harness，并让桌面客户端共享 `/config` 中的插件、模型配置和历史记录，以及 `/workspaces` 中的工作区。容器不会挂载 Docker Socket，也不会把 Harness 的 HTTP 端口暴露到局域网；只有 Caddy 的 HTTPS 端口对外开放。

## 启动

1. 复制 `.env.example` 为 `.env`，设置 NAS 专用的根域名，例如 `harness.local`。v1 不支持子路径。
2. 确保该域名在每台电脑上解析到 NAS，并确保 `CONFIG_PATH`、`WORKSPACES_PATH` 可由 `PUID:PGID` 写入。
3. 在仓库根目录执行 `docker compose --env-file deploy/nas/.env -f deploy/nas/compose.yaml up -d --build`。
4. 查看 `docker compose --env-file deploy/nas/.env -f deploy/nas/compose.yaml logs harness`，取得十分钟内有效的一次性八位配对码。
5. 在 NAS 管理终端运行 `docker compose --env-file deploy/nas/.env -f deploy/nas/compose.yaml run --rm identity`，取得站点证书的 TLS SHA-256 指纹。
6. 在桌面端“设置 → 运行端与 NAS”输入 `https://<NAS_HOSTNAME>`。首次连接会显示 TLS SHA-256 指纹；必须与上一步通过 NAS 管理终端取得的值一致，再输入配对码。

Caddy 首次启动会生成内部 CA 与站点证书，并把状态保存在 `caddy_data` 卷。重建容器不会改变证书；删除该卷会改变指纹，桌面端将拒绝旧连接，必须重新核对并配对。

初始配对码通过可信服务器控制台建立管理员，而不是根据网络请求到达顺序授予权限。配对码十分钟后到期且只能使用一次。连续输错十次会锁定普通配对；公开健康请求不会续期配对码。管理员可在桌面设置中签发绑定角色的新邀请，默认角色为使用者。设备令牌默认有效 90 天。

`discovery` 服务使用 Linux host 网络发布 `_open-dsh._tcp.local` mDNS 记录，桌面端可以据此预填地址。发现记录不是信任凭据，仍必须核对证书并输入配对码。若 NAS 不允许 host 网络或 UDP 5353，请删除或禁用该服务并手动输入地址；核心连接不依赖 mDNS。

## 数据与恢复

所有角色共享同一资料库；角色限制产品操作，不提供操作系统隔离，也不在可以读取共享历史的人之间提供隐私隔离。

| 操作 | 管理员 | 使用者 | 只读 |
|---|---|---|---|
| 浏览历史、附件及允许的工作区文件 | 允许 | 允许 | 允许 |
| 新建或继续任务、上传文件、回答普通问题 | 允许 | 允许 | 禁止 |
| 停止活动任务 | 任意任务 | 仅此设备发起的任务 | 禁止 |
| 批准危险操作 | 允许 | 禁止 | 禁止 |
| 管理设备、角色、插件、凭据或服务器设置 | 允许 | 禁止 | 禁止 |
| 永久删除历史或导出原始日志 | 允许 | 禁止 | 禁止 |

使用者任务仍遵守服务器工具、沙箱及审批策略。非管理员不能访问未分类的第三方 HTTP、WebSocket 或 RPC 接口。文件预览校验已登记共享工作区内的真实路径，拒绝敏感控制文件及符号链接越界。服务器不会向远程管理员暴露本机专用的 Electron 操作。

升级先把旧设备记录备份到凭据键 `client-connection/nas-devices-before-roles`，保留设备身份和有效期，再迁移为管理员。管理员设置展示迁移提示及角色调整入口；升级后请审核这些设备。撤销、降权及过期会结束相关设备连接和交互，但不会撤销任务已产生的副作用。常规管理禁止撤销或降权最后一个有效管理员。

若所有管理员授权均已过期，请在可信服务器的 `/opt/open-dsh` 中，以 Harness 相同的文件系统身份执行 `node lib/bin.js nas-admin-recovery --credentials-file /config/.credentials.yaml`。本地 CLI 打印临时一次性管理员配对码，不启动网络服务器并保留无关凭据。用此代码配对新设备，再审核旧授权。不提供远程管理员恢复端点。不要把配对码或恢复码发布到公开日志。

- `/config` 是必须备份的 Harness 数据目录，包含历史记录、插件和模型设置。
- `/workspaces` 是共享工作目录。默认不会自动迁移任何桌面文件；请由用户显式复制。
- 升级前先备份两个挂载目录。当前预览版不会访问 Docker Socket，也不会自动更新容器。
- 桌面离线时不会静默回退到本机 Harness。可在连接页重试或切回本机。

若使用已有受信任的 HTTPS 反向代理，可只运行 `harness` 服务并把代理转发到同一 Docker 网络内的 `harness:3080`。不要直接向局域网发布 3080 端口。

角色、恢复及授权行为已有本地聚焦测试证据。本次合并尚未在运行中的 NAS Docker 部署验证；部署人员仍需在目标 NAS 验证 Compose 启动、HTTPS 和配对。
