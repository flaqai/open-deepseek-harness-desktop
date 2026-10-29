/**
 * Client-safe data model for the MCP management panel.
 *
 * The shapes mirror `@deepseek-ai/dsh-mcp-client`'s `StdioConfig` /
 * `StreamableHttpConfig` (see packages/mcp/mcp-client/src/index.ts) so a row the
 * panel writes is byte-for-byte what the MCP client plugin expects as its
 * config. No harness value imports here — only plain JSON types — so this file
 * is safe to bundle into the browser half.
 */

/** Transport discriminator, matching the MCP client config. */
export type McpTransport = 'stdio' | 'streamable-http'

/** Automatic reconnect policy (subset surfaced by the panel's editor). */
export interface McpReconnectConfig {
  enabled?: boolean
  initialDelayMs?: number
  maxDelayMs?: number
  maxAttempts?: number
}

/** One MCP server as stored in the profile patch config. */
export interface McpServerConfig {
  transport: McpTransport
  /** Stable namespace, `[A-Za-z0-9_-]{1,32}`, unique across live servers. */
  serverName: string
  /** stdio: executable; streamable-http omitted. */
  command?: string
  /** stdio: arguments passed directly (no shell). */
  args?: string[]
  /** stdio: extra env merged over the scrubbed ambient env. */
  env?: Record<string, string>
  /** stdio: child working directory. */
  cwd?: string
  /** streamable-http: MCP endpoint URL. */
  url?: string
  /** streamable-http: extra headers on MCP requests. */
  headers?: Record<string, string>
  /** Per tool call / resource request timeout, milliseconds. */
  toolCallTimeoutMs?: number
  /** Fail plugin activation when the initial connection fails. */
  failOnStartupError?: boolean
  /** Reconnect policy; omission uses client defaults. */
  reconnect?: McpReconnectConfig
}

/** Scope tab identity: the user level plus each open workspace. */
export interface McpScope {
  /** Stable id: `user` or a workspace root path. */
  id: string
  label: string
  /** true for the user-level (profile-global) tab. */
  user: boolean
}

/** One server row as rendered by the panel. */
export interface McpServerView {
  /** Loader entry id, e.g. `mcp-context7`. */
  id: string
  serverName: string
  transport: McpTransport
  config: McpServerConfig
  enabled: boolean
  /** Where the row came from: profile patch, a bundle, or a command overlay. */
  source: 'profile' | 'bundle' | 'override'
  /** Whether this deployment can edit the row (bundle/override rows are read-only). */
  editable: boolean
}

/** A tool surfaced from a connected server (name + trimmed description). */
export interface McpToolView {
  name: string
  description: string
}

/** Result envelope the remote returns, mirroring the harness Remote convention. */
export type McpRemoteResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** The outcome of a write: whether it applied live or needs a restart. */
export type McpApplication = 'applied' | 'restart-required'

/** Persisted mutation outcome and the current Loader inventory; no-HMR changes await restart. */
export interface McpWriteResult {
  application: McpApplication
  servers: McpServerView[]
}
