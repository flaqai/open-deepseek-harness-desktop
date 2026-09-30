/** NAS runtime directory, pairing client, and device-local credential store. */

import { createHash } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { connect as connectTls } from 'node:tls'
import {
  NAS_PROTOCOL_V1,
  NasProtocolViolation,
  type NasDeviceSummary,
  type NasHealthDocument,
  type NasPairingDocument,
} from '@deepseek-ai/dsh-nas-protocol'

export const NAS_PROTOCOL_VERSION = NAS_PROTOCOL_V1.version
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

export type DesktopRuntimeSelection =
  | { readonly kind: 'local' }
  | { readonly kind: 'nas'; readonly serverId: string }

export interface NasRuntimeRecord {
  readonly id: string
  readonly name: string
  readonly baseUrl: string
  readonly certificateFingerprint?: string
  readonly deviceId?: string
  readonly credentialExpiresAt?: string
  readonly lastConnectedAt?: string
}

export interface NasRuntimeDirectory {
  readonly schema: 'open-deepseek-harness-desktop/nas-runtimes/v1'
  readonly selection: DesktopRuntimeSelection
  readonly servers: readonly NasRuntimeRecord[]
}

export type NasHealth = NasHealthDocument

export interface NasPairingRequest {
  readonly baseUrl: string
  readonly code: string
  readonly deviceName: string
  readonly certificateFingerprint?: string
}

export type NasPairingResponse = NasPairingDocument

export interface NasRuntimeStatus {
  readonly selection: DesktopRuntimeSelection
  readonly servers: readonly NasRuntimeRecord[]
  readonly secureStorageAvailable: boolean
  readonly active?: NasRuntimeRecord
}

export type { NasDeviceSummary } from '@deepseek-ai/dsh-nas-protocol'

export interface NasDiscoveryCandidate {
  readonly baseUrl: string
  readonly name: string
}

interface NasSecretRecord {
  readonly deviceId: string
  readonly sealedToken: string
}

interface NasSecretDocument {
  readonly schema: 'open-deepseek-harness-desktop/nas-secrets/v1'
  readonly records: Readonly<Record<string, NasSecretRecord>>
}

export interface NasSecretCodec {
  readonly available: boolean
  seal(value: string): string
  open(value: string): string
}

export interface NasFetchResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

export type NasFetch = (
  url: string,
  init: { readonly method: 'GET' | 'POST'; readonly headers?: Readonly<Record<string, string>>; readonly body?: string; readonly signal: AbortSignal },
) => Promise<NasFetchResponse>

const MDNS_GROUP = '224.0.0.251'
const MDNS_PORT = 5353
const MDNS_SERVICE = '_open-dsh._tcp.local'

function dnsName(value: string): Buffer {
  return Buffer.concat([...value.split('.').map((label) => {
    const bytes = Buffer.from(label)
    return Buffer.concat([Buffer.from([bytes.length]), bytes])
  }), Buffer.from([0])])
}

function discoveryQuery(): Buffer {
  const typeAndClass = Buffer.allocUnsafe(4)
  typeAndClass.writeUInt16BE(12, 0)
  typeAndClass.writeUInt16BE(0x8001, 2)
  return Buffer.concat([
    Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
    dnsName(MDNS_SERVICE),
    typeAndClass,
  ])
}

/** Parse the allowlisted URL and display name from one untrusted mDNS response. */
export function parseNasDiscoveryPacket(packet: Uint8Array): NasDiscoveryCandidate | undefined {
  const values: string[] = []
  const bytes = Buffer.from(packet)
  for (let offset = 0; offset < bytes.length; offset += 1) {
    const length = bytes[offset] ?? 0
    if (length < 1 || offset + 1 + length > bytes.length) continue
    const value = bytes.subarray(offset + 1, offset + 1 + length).toString('utf8')
    if (/^(?:dsh-protocol|url|name)=/u.test(value)) values.push(value)
  }
  if (!values.includes(`dsh-protocol=${String(NAS_PROTOCOL_V1.version)}`)) return undefined
  const rawUrl = values.find(value => value.startsWith('url='))?.slice(4)
  if (rawUrl === undefined) return undefined
  try {
    return {
      baseUrl: normalizeNasBaseUrl(rawUrl),
      name: values.find(value => value.startsWith('name='))?.slice(5).trim() || new URL(rawUrl).hostname,
    }
  } catch { return undefined }
}

/** Discover untrusted LAN suggestions; callers still require certificate review and pairing. */
export function discoverNasRuntimes(timeoutMs = 2_000): Promise<readonly NasDiscoveryCandidate[]> {
  return new Promise((resolve) => {
    const candidates = new Map<string, NasDiscoveryCandidate>()
    const socket = createSocket('udp4')
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      resolve([...candidates.values()])
    }
    const timer = setTimeout(finish, timeoutMs)
    socket.on('message', (packet) => {
      const candidate = parseNasDiscoveryPacket(packet)
      if (candidate !== undefined) candidates.set(candidate.baseUrl, candidate)
    })
    socket.once('error', finish)
    socket.bind(0, () => {
      socket.setMulticastTTL(255)
      socket.send(discoveryQuery(), MDNS_PORT, MDNS_GROUP, (error) => {
        if (error !== null) finish()
      })
    })
  })
}

const EMPTY_DIRECTORY: NasRuntimeDirectory = Object.freeze({
  schema: 'open-deepseek-harness-desktop/nas-runtimes/v1',
  selection: { kind: 'local' as const },
  servers: [],
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeFingerprint(value: string): string {
  const compact = value.replaceAll(':', '').trim().toUpperCase()
  if (!/^[A-F0-9]{64}$/u.test(compact)) {
    throw new TypeError('desktop: NAS certificate fingerprint must be a SHA-256 digest')
  }
  return compact.match(/.{2}/gu)?.join(':') ?? compact
}

/** Parse one user-entered NAS URL into its canonical HTTPS origin. */
export function normalizeNasBaseUrl(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new TypeError('desktop: NAS address must be a valid URL') }
  if (url.protocol !== 'https:') throw new TypeError('desktop: NAS address must use HTTPS')
  if (url.username !== '' || url.password !== '') throw new TypeError('desktop: NAS address cannot contain credentials')
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new TypeError('desktop: NAS v1 requires a dedicated HTTPS origin without a path, query, or fragment')
  }
  url.pathname = '/'
  return url.origin
}

function parseHealth(raw: unknown): NasHealth {
  try {
    return NAS_PROTOCOL_V1.health.response.parse(raw)
  } catch (error) {
    if (!(error instanceof NasProtocolViolation)) throw error
    throw new Error('desktop: NAS returned an invalid health document')
  }
}

function parsePairing(raw: unknown): NasPairingResponse {
  try {
    return NAS_PROTOCOL_V1.pair.response.parse(raw)
  } catch (error) {
    if (!(error instanceof NasProtocolViolation)) throw error
    throw new Error('desktop: NAS returned an invalid pairing response')
  }
}

function parseDevices(raw: unknown): readonly NasDeviceSummary[] {
  try {
    return NAS_PROTOCOL_V1.devices.response.parse(raw).devices
  } catch (error) {
    if (!(error instanceof NasProtocolViolation)) throw error
    throw new Error('desktop: NAS returned an invalid device list')
  }
}

function normalizeDirectory(raw: unknown): NasRuntimeDirectory {
  if (!isRecord(raw) || raw.schema !== EMPTY_DIRECTORY.schema || !Array.isArray(raw.servers)) return EMPTY_DIRECTORY
  const servers: NasRuntimeRecord[] = []
  for (const candidate of raw.servers) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || candidate.id === ''
      || typeof candidate.name !== 'string' || candidate.name === '' || typeof candidate.baseUrl !== 'string') continue
    try {
      servers.push({
        id: candidate.id,
        name: candidate.name,
        baseUrl: normalizeNasBaseUrl(candidate.baseUrl),
        ...(typeof candidate.certificateFingerprint === 'string'
          ? { certificateFingerprint: normalizeFingerprint(candidate.certificateFingerprint) }
          : {}),
        ...(typeof candidate.deviceId === 'string' ? { deviceId: candidate.deviceId } : {}),
        ...(typeof candidate.credentialExpiresAt === 'string' ? { credentialExpiresAt: candidate.credentialExpiresAt } : {}),
        ...(typeof candidate.lastConnectedAt === 'string' ? { lastConnectedAt: candidate.lastConnectedAt } : {}),
      })
    } catch { /* ignore malformed persisted rows without discarding healthy rows */ }
  }
  const selectedServerId = isRecord(raw.selection) && raw.selection.kind === 'nas'
    && typeof raw.selection.serverId === 'string' ? raw.selection.serverId : undefined
  const selection = selectedServerId !== undefined && servers.some(server => server.id === selectedServerId)
    ? { kind: 'nas' as const, serverId: selectedServerId }
    : { kind: 'local' as const }
  return { schema: EMPTY_DIRECTORY.schema, selection, servers }
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
}

/** Durable metadata plus secure per-device credentials. */
export class NasRuntimeStore {
  constructor(
    private readonly directoryPath: string,
    private readonly secretPath: string,
    private readonly codec: NasSecretCodec,
    private readonly reportReadFailure: (error: unknown) => void = () => {},
  ) {}

  read(): NasRuntimeDirectory {
    try { return normalizeDirectory(JSON.parse(readFileSync(this.directoryPath, 'utf8'))) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.reportReadFailure(error)
      return EMPTY_DIRECTORY
    }
  }

  status(): NasRuntimeStatus {
    const directory = this.read()
    const selectedServerId = directory.selection.kind === 'nas' ? directory.selection.serverId : undefined
    const active = selectedServerId === undefined
      ? undefined
      : directory.servers.find(server => server.id === selectedServerId)
    return {
      selection: directory.selection,
      servers: directory.servers,
      secureStorageAvailable: this.codec.available,
      ...(active === undefined ? {} : { active }),
    }
  }

  select(selection: DesktopRuntimeSelection): NasRuntimeStatus {
    const current = this.read()
    if (selection.kind === 'nas' && !current.servers.some(server => server.id === selection.serverId)) {
      throw new Error('desktop: selected NAS is not saved')
    }
    writeAtomic(this.directoryPath, { ...current, selection })
    return this.status()
  }

  savePairing(baseUrl: string, pairing: NasPairingResponse, fingerprint?: string): NasRuntimeStatus {
    if (!this.codec.available) throw new Error('desktop: system secure storage is unavailable; NAS credentials cannot be persisted')
    const current = this.read()
    const canonical = normalizeNasBaseUrl(baseUrl)
    const existing = current.servers.find(server => server.baseUrl === canonical || server.id === pairing.health.instanceId)
    const id = existing?.id ?? pairing.health.instanceId
    const record: NasRuntimeRecord = {
      id,
      name: pairing.health.name,
      baseUrl: canonical,
      ...(fingerprint === undefined ? {} : { certificateFingerprint: normalizeFingerprint(fingerprint) }),
      deviceId: pairing.deviceId,
      credentialExpiresAt: pairing.expiresAt,
      lastConnectedAt: new Date().toISOString(),
    }
    const servers = [...current.servers.filter(server => server.id !== id && server.baseUrl !== canonical), record]
    writeAtomic(this.directoryPath, { ...current, servers })
    const secrets = this.readSecrets()
    writeAtomic(this.secretPath, {
      schema: 'open-deepseek-harness-desktop/nas-secrets/v1',
      records: { ...secrets.records, [id]: { deviceId: pairing.deviceId, sealedToken: this.codec.seal(pairing.token) } },
    } satisfies NasSecretDocument)
    return this.status()
  }

  credential(serverId: string): { readonly deviceId: string; readonly token: string } | undefined {
    if (!this.codec.available) return undefined
    const value = this.readSecrets().records[serverId]
    if (value === undefined) return undefined
    return { deviceId: value.deviceId, token: this.codec.open(value.sealedToken) }
  }

  remove(serverId: string): NasRuntimeStatus {
    const current = this.read()
    const servers = current.servers.filter(server => server.id !== serverId)
    const selection = current.selection.kind === 'nas' && current.selection.serverId === serverId
      ? { kind: 'local' as const }
      : current.selection
    writeAtomic(this.directoryPath, { ...current, selection, servers })
    const secrets = this.readSecrets()
    const records = Object.fromEntries(Object.entries(secrets.records).filter(([id]) => id !== serverId))
    writeAtomic(this.secretPath, { ...secrets, records })
    return this.status()
  }

  private readSecrets(): NasSecretDocument {
    try {
      const raw: unknown = JSON.parse(readFileSync(this.secretPath, 'utf8'))
      if (!isRecord(raw) || raw.schema !== 'open-deepseek-harness-desktop/nas-secrets/v1' || !isRecord(raw.records)) {
        throw new Error('desktop: NAS secret store has an unsupported format')
      }
      const records: Record<string, NasSecretRecord> = {}
      for (const [id, value] of Object.entries(raw.records)) {
        if (isRecord(value) && typeof value.deviceId === 'string' && typeof value.sealedToken === 'string') {
          records[id] = { deviceId: value.deviceId, sealedToken: value.sealedToken }
        }
      }
      return { schema: 'open-deepseek-harness-desktop/nas-secrets/v1', records }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.reportReadFailure(error)
      return { schema: 'open-deepseek-harness-desktop/nas-secrets/v1', records: {} }
    }
  }
}

function timeoutSignal(timeoutMs: number): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort(new Error('desktop: NAS request timed out')) }, timeoutMs)
  return { signal: controller.signal, dispose: () => { clearTimeout(timer) } }
}

/** Narrow network adapter for health and pairing; arbitrary paths never cross the renderer bridge. */
export class NasRuntimeClient {
  constructor(private readonly fetch: NasFetch, private readonly timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {}

  async health(baseUrl: string, token?: string): Promise<NasHealth> {
    const origin = normalizeNasBaseUrl(baseUrl)
    const timeout = timeoutSignal(this.timeoutMs)
    try {
      const response = await this.fetch(`${origin}${NAS_PROTOCOL_V1.health.path}`, {
        method: NAS_PROTOCOL_V1.health.method, signal: timeout.signal,
        ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
      })
      if (!response.ok) throw new Error(`desktop: NAS health check failed with HTTP ${String(response.status)}`)
      const health = parseHealth(await response.json())
      if (health.protocolVersion !== NAS_PROTOCOL_VERSION) {
        throw new Error(`desktop: NAS protocol ${String(health.protocolVersion)} is incompatible with desktop protocol ${String(NAS_PROTOCOL_VERSION)}`)
      }
      return health
    } finally { timeout.dispose() }
  }

  async pair(request: NasPairingRequest): Promise<NasPairingResponse> {
    const origin = normalizeNasBaseUrl(request.baseUrl)
    const code = request.code.replaceAll(/\s/gu, '')
    if (!/^[0-9]{8}$/u.test(code)) throw new TypeError('desktop: NAS pairing code must contain 8 digits')
    const deviceName = request.deviceName.trim()
    if (deviceName.length < 1 || deviceName.length > 80) throw new TypeError('desktop: device name must contain 1 to 80 characters')
    const timeout = timeoutSignal(this.timeoutMs)
    try {
      const response = await this.fetch(`${origin}${NAS_PROTOCOL_V1.pair.path}`, {
        method: NAS_PROTOCOL_V1.pair.method, signal: timeout.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(NAS_PROTOCOL_V1.pair.request.create({ code, deviceName })),
      })
      if (!response.ok) throw new Error(`desktop: NAS pairing failed with HTTP ${String(response.status)}`)
      const pairing = parsePairing(await response.json())
      if (pairing.health.protocolVersion !== NAS_PROTOCOL_VERSION) {
        throw new Error(`desktop: NAS protocol ${String(pairing.health.protocolVersion)} is incompatible`)
      }
      return pairing
    } finally { timeout.dispose() }
  }

  async devices(baseUrl: string, token: string): Promise<readonly NasDeviceSummary[]> {
    return this.deviceRequest(baseUrl, token, NAS_PROTOCOL_V1.devices.method)
  }

  async revokeDevice(baseUrl: string, token: string, deviceId: string): Promise<readonly NasDeviceSummary[]> {
    if (!/^[a-f0-9]{32}$/u.test(deviceId)) throw new TypeError('desktop: invalid NAS device id')
    return this.deviceRequest(
      baseUrl,
      token,
      NAS_PROTOCOL_V1.revokeDevice.method,
      JSON.stringify(NAS_PROTOCOL_V1.revokeDevice.request.create({ revokeDeviceId: deviceId })),
    )
  }

  private async deviceRequest(
    baseUrl: string,
    token: string,
    method: 'GET' | 'POST',
    body?: string,
  ): Promise<readonly NasDeviceSummary[]> {
    const origin = normalizeNasBaseUrl(baseUrl)
    const timeout = timeoutSignal(this.timeoutMs)
    try {
      const response = await this.fetch(`${origin}${NAS_PROTOCOL_V1.devices.path}`, {
        method, signal: timeout.signal,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body }),
      })
      if (!response.ok) throw new Error(`desktop: NAS device request failed with HTTP ${String(response.status)}`)
      return parseDevices(await response.json())
    } finally { timeout.dispose() }
  }
}

/** Canonical SHA-256 certificate fingerprint used for first-contact pinning. */
export function certificateFingerprint(rawCertificate: Uint8Array): string {
  return createHash('sha256').update(rawCertificate).digest('hex').toUpperCase().match(/.{2}/gu)?.join(':') ?? ''
}

/** Read the peer certificate without trusting it; callers must present the fingerprint before saving the pin. */
export async function inspectNasCertificate(baseUrl: string, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<string> {
  const url = new URL(normalizeNasBaseUrl(baseUrl))
  return new Promise<string>((resolve, reject) => {
    const socket = connectTls({
      host: url.hostname,
      port: url.port === '' ? 443 : Number(url.port),
      servername: url.hostname,
      rejectUnauthorized: false,
    })
    const timer = setTimeout(() => {
      socket.destroy(new Error('desktop: NAS certificate inspection timed out'))
    }, timeoutMs)
    const finish = (operation: () => void): void => {
      clearTimeout(timer)
      socket.destroy()
      operation()
    }
    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate()
      if (certificate.raw.length === 0) {
        finish(() => { reject(new Error('desktop: NAS did not present a certificate')) })
        return
      }
      finish(() => { resolve(certificateFingerprint(certificate.raw)) })
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}
