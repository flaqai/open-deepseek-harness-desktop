# NAS deployment (preview)

English | [中文](README.zh.md)

This Compose deployment runs Harness on a NAS. Desktop clients share plugins, model settings, and sessions under `/config`, plus workspaces under `/workspaces`. The stack neither mounts the Docker socket nor publishes Harness HTTP to the LAN; only Caddy HTTPS is exposed.

## Start

1. Copy `.env.example` to `.env` and configure a dedicated root hostname such as `harness.local`. Version 1 does not support a URL subpath.
2. Make the hostname resolve to the NAS from every client, and make `CONFIG_PATH` and `WORKSPACES_PATH` writable by `PUID:PGID`.
3. From the repository root, run `docker compose --env-file deploy/nas/.env -f deploy/nas/compose.yaml up -d --build`.
4. Run `docker compose --env-file deploy/nas/.env -f deploy/nas/compose.yaml logs harness` and read the one-time eight-digit pairing code, which is valid for ten minutes.
5. On the NAS administration terminal, run `docker compose --env-file deploy/nas/.env -f deploy/nas/compose.yaml run --rm identity` to read the site certificate's TLS SHA-256 fingerprint.
6. In Desktop, open **Settings → Runtime & NAS** and enter `https://<NAS_HOSTNAME>`. Require the displayed fingerprint to match the independently observed value before entering the pairing code.

Caddy creates an internal CA and site certificate on first start and persists them in `caddy_data`. Recreating containers does not change the certificate. Deleting that volume changes the fingerprint, so Desktop rejects the previous identity until it is reviewed and paired again.

The initial code establishes an administrator through the trusted server console, not through request arrival order. Codes expire after ten minutes and are single-use. Ten consecutive invalid attempts lock ordinary pairing; public health requests do not renew the code. An administrator can issue a new role-bound invitation in Desktop settings; its default role is user. Device grants expire after 90 days by default.

The `discovery` service uses Linux host networking to publish `_open-dsh._tcp.local` over mDNS. Desktop uses it only to suggest an address; certificate review and pairing remain mandatory. If the NAS cannot grant host networking or UDP 5353, disable that service and enter the HTTPS origin manually. Core connectivity does not depend on mDNS.

## Data and recovery

All roles share one library; roles restrict product operations, not operating-system access or privacy between people who can read shared history.

| Operation | Administrator | User | Read-only |
|---|---|---|---|
| Browse history, attachments and allowed workspace files | Yes | Yes | Yes |
| Create or continue tasks, upload files, answer ordinary questions | Yes | Yes | No |
| Stop an active task | Any task | Only the task this device started | No |
| Approve dangerous operations | Yes | No | No |
| Manage devices, roles, plugins, credentials or server settings | Yes | No | No |
| Permanently delete history or export raw logs | Yes | No | No |

User tasks still obey server tool, sandbox and approval policies. Non-administrators cannot access unclassified third-party HTTP, WebSocket or RPC interfaces. File previews resolve real paths inside registered shared workspaces and refuse sensitive control files and escaping symlinks. The server does not expose local-only Electron operations to remote administrators.

An upgrade backs up legacy device records under the credential key `client-connection/nas-devices-before-roles`, preserves their identities and expiry, and migrates them to administrators. Administrator settings show the migration notice and role adjustment controls. Review those devices after upgrading. Revocation, demotion and expiry end the affected device's connections and interactions; they do not undo task side effects. Normal management refuses to revoke or demote the last active administrator.

If all administrator grants expire, run `node lib/bin.js nas-admin-recovery --credentials-file /config/.credentials.yaml` on the trusted server in `/opt/open-dsh`, using the same filesystem identity as Harness. The local CLI prints a temporary single-use administrator code, does not start a network server and preserves unrelated credentials. Pair a new device with that code, then review old grants. There is no remote administrator-recovery endpoint. Never post pairing or recovery codes in public logs.

- `/config` is the required Harness backup target and contains sessions, plugins, and model settings.
- `/workspaces` contains shared workspaces. The deployment does not migrate desktop files automatically; copy them only through an explicit user operation.
- Back up both mounted directories before an upgrade. This preview does not access the Docker socket or update containers automatically.
- Desktop never silently falls back to local Harness when NAS is offline. Retry the connection or explicitly switch back to local runtime.

When using an existing trusted HTTPS reverse proxy, run only the `harness` service and proxy to `harness:3080` on the same Docker network. Do not publish port 3080 directly to the LAN.

Role, recovery and authorization behavior has focused local test coverage. This merge has not been validated on a running NAS Docker deployment; the deployment operator must verify Compose startup, HTTPS and pairing on the target NAS.
