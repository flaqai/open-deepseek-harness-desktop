/** Loopback CONNECT router that applies independent npm and GitHub proxy policies. */

import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage } from 'node:http'
import { connect as connectTcp, type Socket } from 'node:net'
import { connect as connectTls } from 'node:tls'
import type {
  DownloadNetworkOperationSnapshot, DownloadNetworkSettings, DownloadNetworkSettingsStore, DownloadProxySettings,
} from './download-network-settings.ts'

const GITHUB_HOSTS = new Set(['github.com', 'api.github.com', 'codeload.github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com'])

interface ProxyEndpoint { url: URL; authorization?: string }

function bypassesEnvironmentProxy(environment: NodeJS.ProcessEnv, target: { host: string; port: number }): boolean {
  const host = target.host.replace(/^\[|\]$/gu, '').replace(/\.$/u, '').toLowerCase()
  const entries = (environment.no_proxy ?? environment.NO_PROXY ?? '').split(/[\s,]+/u)
  for (const raw of entries) {
    const entry = raw.trim().toLowerCase()
    if (entry === '') continue
    if (entry === '*') return true
    const bracket = /^\[([^\]]+)\](?::(\d+))?$/u.exec(entry)
    const ordinary = bracket === null && entry.indexOf(':') === entry.lastIndexOf(':')
      ? /^([^:]+)(?::(\d+))?$/u.exec(entry) : undefined
    const candidate = (bracket?.[1] ?? ordinary?.[1] ?? entry).replace(/^\*?\./u, '').replace(/\.$/u, '')
    const port = bracket?.[2] ?? ordinary?.[2]
    if (port !== undefined && Number(port) !== target.port) continue
    if (host === candidate || host.endsWith(`.${candidate}`)) return true
  }
  return false
}

function environmentProxy(environment: NodeJS.ProcessEnv, target: { host: string; port: number }): string | undefined {
  if (bypassesEnvironmentProxy(environment, target)) return undefined
  return environment.https_proxy ?? environment.HTTPS_PROXY ?? environment.all_proxy ?? environment.ALL_PROXY
    ?? environment.http_proxy ?? environment.HTTP_PROXY
}

function endpoint(
  proxy: DownloadProxySettings,
  password: string | undefined,
  environment: NodeJS.ProcessEnv,
  target: { host: string; port: number },
): ProxyEndpoint | undefined {
  const value = proxy.mode === 'custom' ? proxy.url
    : proxy.mode === 'existing' ? environmentProxy(environment, target) : undefined
  if (value === undefined) return undefined
  const url = new URL(value)
  const username = proxy.mode === 'custom' ? proxy.username : decodeURIComponent(url.username)
  const secret = proxy.mode === 'custom' ? password : decodeURIComponent(url.password)
  url.username = ''; url.password = ''
  const authorization = username === undefined || username === '' ? undefined
    : `Basic ${Buffer.from(`${username}:${secret ?? ''}`).toString('base64')}`
  return { url, ...(authorization === undefined ? {} : { authorization }) }
}

function parseAuthority(authority: string): { host: string; port: number } | undefined {
  try {
    const parsed = new URL(`https://${authority}`)
    const port = parsed.port === '' ? 443 : Number(parsed.port)
    if (parsed.hostname === '' || !Number.isSafeInteger(port) || port < 1 || port > 65_535) return undefined
    return { host: parsed.hostname, port }
  } catch { return undefined }
}

function connectDirect(host: string, port: number, ready: (socket: Socket) => void, fail: (error: Error) => void): Socket {
  const onError = (error: Error): void => { fail(error) }
  const socket = connectTcp({ host, port }, () => { socket.off('error', onError); ready(socket) })
  socket.once('error', onError)
  return socket
}

function connectThroughProxy(
  upstream: ProxyEndpoint,
  authority: string,
  ready: (socket: Socket) => void,
  fail: (error: Error) => void,
): Socket {
  const port = Number(upstream.url.port || (upstream.url.protocol === 'https:' ? '443' : '80'))
  const connected = (): void => {
    const lines = [`CONNECT ${authority} HTTP/1.1`, `Host: ${authority}`]
    if (upstream.authorization !== undefined) lines.push(`Proxy-Authorization: ${upstream.authorization}`)
    socket.write(`${lines.join('\r\n')}\r\n\r\n`)
  }
  const socket = upstream.url.protocol === 'https:'
    ? connectTls({ host: upstream.url.hostname, port, servername: upstream.url.hostname }, connected)
    : connectTcp({ host: upstream.url.hostname, port }, connected)
  let response = Buffer.alloc(0)
  const onError = (error: Error): void => { fail(error) }
  const onData = (chunk: Buffer): void => {
    response = Buffer.concat([response, chunk])
    if (response.length > 16 * 1024) { fail(new Error('Upstream proxy returned oversized headers')); socket.destroy(); return }
    const boundary = response.indexOf('\r\n\r\n')
    if (boundary < 0) return
    socket.off('data', onData)
    const status = /^HTTP\/1\.[01] (\d{3})/u.exec(response.subarray(0, boundary).toString('latin1'))
    if (status?.[1] !== '200') { fail(new Error(`Upstream proxy CONNECT returned ${status?.[1] ?? 'invalid response'}`)); socket.destroy(); return }
    const remaining = response.subarray(boundary + 4)
    if (remaining.length > 0) socket.unshift(remaining)
    socket.off('error', onError)
    ready(socket)
  }
  socket.on('data', onData)
  socket.once('error', onError)
  return socket
}

/** Running proxy URL and lifecycle. */
export interface PluginDownloadProxy {
  readonly pluginUrl: string
  readonly pluginProxyRules: string
  readonly pluginProxyCredentials: { username: string; password: string }
  readonly applicationProxyRules: string
  readonly applicationProxyCredentials: { username: string; password: string }
  close(): Promise<void>
}

/** Start an authenticated loopback proxy whose policies are read for every new connection. */
export async function startPluginDownloadProxy(
  settingsStore: DownloadNetworkSettingsStore,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PluginDownloadProxy> {
  const token = randomBytes(24).toString('base64url')
  const revisionSnapshots = new Map<number, DownloadNetworkOperationSnapshot>()
  const sockets = new Set<Socket>()
  const server = createServer((_request, response) => {
    response.writeHead(405, { Connection: 'close' }); response.end()
  })
  server.on('connect', (request: IncomingMessage, client: Socket, head: Buffer) => {
    sockets.add(client); client.once('close', () => { sockets.delete(client) })
    const authorization = request.headers['proxy-authorization']
    let identity: string | undefined
    if (typeof authorization === 'string' && authorization.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8')
        const separator = decoded.indexOf(':')
        if (separator > 0 && decoded.slice(separator + 1) === token) identity = decoded.slice(0, separator)
      } catch { /* Invalid credentials are rejected below. */ }
    }
    if ((identity !== 'plugins' && identity !== 'application' && identity !== 'npm' && identity !== 'github'
      && !/^plugins-\d+$/u.test(identity ?? '')) || request.url === undefined) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\nConnection: close\r\n\r\n'); return
    }
    const target = parseAuthority(request.url)
    if (target === undefined) { client.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return }
    const requestedRevision = identity?.startsWith('plugins-') ? Number(identity.slice('plugins-'.length)) : undefined
    let snapshot = requestedRevision === undefined ? undefined : revisionSnapshots.get(requestedRevision)
    if (requestedRevision !== undefined && snapshot === undefined) {
      snapshot = settingsStore.operationSnapshot(requestedRevision)
      if (snapshot === undefined) { client.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n'); return }
      revisionSnapshots.set(requestedRevision, snapshot)
      while (revisionSnapshots.size > 16) {
        const oldestRevision = revisionSnapshots.keys().next().value
        if (oldestRevision === undefined) break
        revisionSnapshots.delete(oldestRevision)
      }
    }
    const settings: DownloadNetworkSettings = snapshot?.settings ?? settingsStore.read()
    const acceleratorHost = settings.github.acceleratorUrl === undefined
      ? undefined : new URL(settings.github.acceleratorUrl).hostname.toLowerCase()
    const selected: 'application' | 'npm' | 'github' = identity === 'application'
      ? 'application' : identity === 'npm' || identity === 'github' ? identity
        : GITHUB_HOSTS.has(target.host.toLowerCase()) || target.host.toLowerCase() === acceleratorHost ? 'github' : 'npm'
    const policy = settings[selected].proxy
    const upstream = policy.mode === 'direct' || policy.mode === 'system' ? undefined
      : endpoint(policy, selected === 'application'
        ? settingsStore.password(selected) : snapshot?.passwords[selected] ?? settingsStore.password(selected), environment, target)
    const fail = (): void => { if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n') }
    const ready = (remote: Socket): void => {
      sockets.add(remote); remote.once('close', () => { sockets.delete(remote) })
      remote.on('error', () => { client.destroy() })
      client.on('error', () => { remote.destroy() })
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length > 0) remote.write(head)
      client.pipe(remote); remote.pipe(client)
    }
    if (upstream === undefined) connectDirect(target.host, target.port, ready, fail)
    else connectThroughProxy(upstream, request.url, ready, fail)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Desktop plugin proxy did not bind a TCP port')
  return {
    pluginUrl: `http://plugins:${token}@127.0.0.1:${address.port}`,
    pluginProxyRules: `http://127.0.0.1:${address.port}`,
    pluginProxyCredentials: { username: 'plugins', password: token },
    applicationProxyRules: `http://127.0.0.1:${address.port}`,
    applicationProxyCredentials: { username: 'application', password: token },
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    },
  }
}

/** Environment read by pnpm and the bundled market for one desktop-controlled operation. */
export function pluginDownloadEnvironment(settingsStore: DownloadNetworkSettingsStore, proxyUrl: string): NodeJS.ProcessEnv {
  const settings = settingsStore.read()
  const registry = settings.npm.registry === 'npmjs' ? 'https://registry.npmjs.org'
    : settings.npm.registry === 'npmmirror' ? 'https://registry.npmmirror.com'
      : settings.npm.registryUrl
  return {
    DSH_DESKTOP_PACKAGE_PROXY_URL: proxyUrl,
    ...(registry === undefined ? {} : { npm_config_registry: registry }),
  }
}
