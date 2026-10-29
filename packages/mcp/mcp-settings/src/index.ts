/**
 * Profile MCP management exposed through the owner-authorized `mcpSettings` Remote.
 *
 * Derived from seanchen88/dsh-pluginHive (MIT); see NOTICE.
 * @module @deepseek-ai/dsh-mcp-settings
 */
const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pull the `Context` declaration merges for services reached via
// `this.ctx` (matches packages/boot/config-editor's imports of these faces).
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-tools'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Generated Host and Remote codecs use Zod at runtime.
import type {} from 'zod'
import {
  type McpServerConfig, type McpServerView, type McpToolView, type McpWriteResult,
} from './types.ts'
import { entryId, listManagedServers, removeServer, setServerEnabled, upsertServer } from './patch-writer.ts'

/** A Loader entry projected onto the panel's row model. */
interface RawEntry {
  id: string
  serverName: string
  config: McpServerConfig
  disabled: boolean
  dynamic: boolean
}

/** Detect parsed YAML expressions without evaluating their source. */
function hasExpression(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  if ('__jsExpr' in value) return true
  return Object.values(value).some(hasExpression)
}

/** Project only static fields accepted by the MCP wire model; dynamic rows never expose credentials. */
function staticMcpConfig(value: unknown): McpServerConfig | undefined {
  if (value === null || typeof value !== 'object' || !('serverName' in value) || !('transport' in value)
    || typeof value.serverName !== 'string' || (value.transport !== 'stdio' && value.transport !== 'streamable-http')) return undefined
  const record = value as Record<string, unknown>
  const config: McpServerConfig = { serverName: value.serverName, transport: value.transport }
  for (const key of ['command', 'cwd', 'url'] as const) {
    if (typeof record[key] === 'string') config[key] = record[key]
  }
  if (Array.isArray(record.args) && record.args.every((arg): arg is string => typeof arg === 'string')) config.args = record.args
  if (typeof record.toolCallTimeoutMs === 'number' && Number.isFinite(record.toolCallTimeoutMs)) config.toolCallTimeoutMs = record.toolCallTimeoutMs
  if (typeof record.failOnStartupError === 'boolean') config.failOnStartupError = record.failOnStartupError
  if (!hasExpression(record)) {
    for (const key of ['env', 'headers'] as const) {
      const fields = record[key]
      if (fields !== null && typeof fields === 'object' && !Array.isArray(fields) && Object.values(fields).every(field => typeof field === 'string')) {
        config[key] = fields as Record<string, string>
      }
    }
    const reconnect = record.reconnect
    if (reconnect !== null && typeof reconnect === 'object') {
      const fields = reconnect as Record<string, unknown>
      config.reconnect = {}
      if (typeof fields.enabled === 'boolean') config.reconnect.enabled = fields.enabled
      for (const key of ['initialDelayMs', 'maxDelayMs', 'maxAttempts'] as const) {
        if (typeof fields[key] === 'number' && Number.isFinite(fields[key])) config.reconnect[key] = fields[key]
      }
    }
  }
  return config
}

/** Plugin name (matches the profile entry id used by cordis.yml). */
export const name = 'mcp-settings'

/** Required services. */
export const inject = ['loader', 'tools', 'profileContext']

/** Owner-authorized MCP inventory and current-Profile configuration mutations. */
export class McpSettingsController extends TypertRemoteService {
  static inject = ['loader', 'tools', 'profileContext']

  constructor(ctx: Context) {
    super(ctx, 'mcpSettings')
  }

  private mcpEntries(): RawEntry[] {
    const rows: RawEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.name !== MCP_CLIENT_MODULE) continue
      const config = staticMcpConfig(entry.options.config)
      if (config === undefined) continue
      rows.push({ id: entry.options.id, serverName: config.serverName, config, disabled: entry.disabled,
        dynamic: hasExpression(entry.options.config) })
    }
    return rows
  }

  /**
   * List every configured MCP server with its editability, without connecting.
   * @returns the rows, ordered by server name.
   */
  @Remote('list')
  async list(): Promise<McpServerView[]> {
    const managed = await listManagedServers(this.ctx)
    return this.mcpEntries().map((row): McpServerView => {
      const isManaged = managed.has(row.id) && row.id === entryId(row.serverName)
      return {
        id: row.id,
        serverName: row.serverName,
        transport: row.config.transport,
        config: row.config,
        enabled: !row.disabled,
        source: isManaged ? 'profile' : 'bundle',
        editable: isManaged && !row.dynamic,
      }
    }).sort((a, b) => a.serverName.localeCompare(b.serverName))
  }

  /**
   * Enumerate the tools a server contributes, read from the live registry.
   * Returns empty while the server is not connected (the panel shows a hint).
   * @param serverName - the MCP namespace.
   * @returns the raw tool names (prefix stripped) and their descriptions.
   */
  @Remote('getTools')
  getTools(serverName: string): McpToolView[] {
    const prefix = `mcp__${serverName}__`
    const schemas = this.ctx.tools.schemas() as Array<{ name: string; description?: string }>
    return schemas
      .filter(schema => schema.name.startsWith(prefix))
      .map(schema => ({ name: schema.name.slice(prefix.length), description: schema.description ?? '' }))
  }

  /**
   * Add or update one server, then reconcile. Validates the namespace and
   * rejects a collision with a different entry before writing.
   * @param config - the resolved MCP client config.
   * @returns the application outcome plus the fresh row list.
   */
  @Remote('upsert')
  async upsert(config: McpServerConfig): Promise<McpWriteResult> {
    validateConfig(config)
    const resolved = withStdioCwd(config)
    const existing = this.mcpEntries().find(row => row.serverName === resolved.serverName)
    if (existing !== undefined && (existing.dynamic || !(await listManagedServers(this.ctx)).has(existing.id))) {
      throw new RemoteError('gateway/bad-request', 'This MCP server belongs to a read-only configuration layer', {})
    }
    const clash = this.mcpEntries().find(row => row.serverName === resolved.serverName && row.id !== entryId(resolved.serverName))
    if (clash !== undefined) {
      throw new RemoteError('gateway/bad-request', `server name "${resolved.serverName}" collides with entry "${clash.id}"`, {})
    }
    const application = await upsertServer(this.ctx, resolved.serverName, resolved)
    return { application, servers: await this.list() }
  }

  /**
   * Remove one server entry (or disable it when owned by a base layer).
   * @param serverName - the namespace to remove.
   * @returns the application outcome plus the fresh row list.
   */
  @Remote('deleteServer')
  async deleteServer(serverName: string): Promise<McpWriteResult> {
    await this.requireManaged(serverName)
    const application = await removeServer(this.ctx, serverName)
    return { application, servers: await this.list() }
  }

  /**
   * Toggle a server's enablement without editing its config.
   * @param serverName - the namespace to toggle.
   * @param enabled - desired state.
   * @returns the application outcome plus the fresh row list.
   */
  @Remote('setEnabled')
  async setEnabled(serverName: string, enabled: boolean): Promise<McpWriteResult> {
    await this.requireManaged(serverName)
    const application = await setServerEnabled(this.ctx, serverName, enabled)
    return { application, servers: await this.list() }
  }

  private async requireManaged(serverName: string): Promise<void> {
    if (!SERVER_NAME_PATTERN.test(serverName) || !(await this.list()).some(row => row.serverName === serverName && row.editable)) {
      throw new RemoteError('gateway/bad-request', 'MCP server is absent or read-only', {})
    }
  }
}

function validateConfig(config: McpServerConfig): void {
  if (config.toolCallTimeoutMs !== undefined && (!Number.isSafeInteger(config.toolCallTimeoutMs) || config.toolCallTimeoutMs <= 0)) {
    throw new RemoteError('gateway/bad-request', 'MCP tool timeout must be a positive safe integer in milliseconds', {})
  }
  if (!SERVER_NAME_PATTERN.test(config.serverName)) {
    throw new RemoteError('gateway/bad-request', `server name "${config.serverName}" must match [A-Za-z0-9_-]{1,32}`, {})
  }
  if (config.transport === 'stdio' && (typeof config.command !== 'string' || config.command.trim() === '')) {
    throw new RemoteError('gateway/bad-request', 'stdio transport requires a command', {})
  }
  if (config.transport === 'streamable-http' && typeof config.url !== 'string') {
    throw new RemoteError('gateway/bad-request', 'streamable-http transport requires a url', {})
  }
  if (config.transport === 'streamable-http') {
    if (typeof config.url !== 'string') throw new RemoteError('gateway/bad-request', 'MCP URL is required', {})
    const url = new URL(config.url)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new RemoteError('gateway/bad-request', 'MCP URL requires HTTP or HTTPS', {})
  }
}

/**
 * Resolve an omitted stdio working directory to the user's home and persist it.
 *
 * @param config - the config the panel submitted.
 * @returns the same config with a concrete `cwd` for stdio rows.
 */
function withStdioCwd(config: McpServerConfig): McpServerConfig {
  if (config.transport !== 'stdio') return config
  const given = config.cwd?.trim()
  return given ? { ...config, cwd: given } : { ...config, cwd: homedir() }
}

/**
 * Mount the panel's host-side Remote.
 * @param ctx - the host Cordis context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(McpSettingsController)
}

export * from './types.ts'
