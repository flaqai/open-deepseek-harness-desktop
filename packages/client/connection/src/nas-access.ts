/** NAS deployment authentication: public health, one-time pairing, and per-device grants. */

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { credentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  NAS_PROTOCOL_V1,
  NasProtocolViolation,
  isNasRole,
  type NasRole,
  type NasDeviceSummary,
  type NasHealthFields,
} from '@deepseek-ai/dsh-nas-protocol'
import { isTrustedApiRequest } from './api-request-trust.ts'

const DEVICE_RECORD_KEY = credentialKey('client-connection', 'nas-devices')
const RECORD_VERSION = 2
const LEGACY_BACKUP_KEY = credentialKey('client-connection', 'nas-devices-before-roles')
const RECOVERY_KEY = credentialKey('client-connection', 'nas-administrator-recovery')
const PAIRING_LIFETIME_MS = 10 * 60_000
const TOKEN_BYTES = 32
const MAX_PAIRING_BODY_BYTES = 4096
const MAX_PAIRING_ATTEMPTS = 10

class LastAdministratorError extends Error {}

interface DeviceRecord {
  readonly id: string
  readonly name: string
  readonly tokenHash: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly role: NasRole
}

interface DeviceDocument {
  readonly version: typeof RECORD_VERSION
  readonly instanceId?: string
  readonly devices: readonly DeviceRecord[]
  readonly consumedPairingHash?: string
  readonly rolesMigrated?: true
}

/** Resolved values required by one NAS Runtime access owner. */
export interface NasDeploymentConfig {
  /** Enable NAS Runtime routes for the current deployment. */
  readonly enabled: boolean
  /** Display name returned in health and pairing documents. */
  readonly name: string
  /** Harness release version returned in health and pairing documents. */
  readonly version: string
  /** NAS Wire Protocol version reported to Desktop. */
  readonly protocolVersion: number
  /** Browser authorities permitted to reach the NAS routes. */
  readonly trustedHosts: readonly string[]
  /** Lifetime in days for each generated Paired Device credential. */
  readonly deviceLifetimeDays: number
  /** Optional fixed eight-digit code; omission generates a random code. */
  readonly pairingCode?: string
}

export type { NasDeviceSummary } from '@deepseek-ai/dsh-nas-protocol'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseDocument(record: CredentialRecord | undefined): DeviceDocument {
  if (record === undefined) return { version: RECORD_VERSION, devices: [] }
  if (record.kind !== 'grant' || !isRecord(record.payload) || (record.payload.version !== 1 && record.payload.version !== RECORD_VERSION)
    || !Array.isArray(record.payload.devices)) {
    throw new Error('client-connection: NAS device credential record has an unsupported format')
  }
  const devices: DeviceRecord[] = []
  for (const value of record.payload.devices) {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string'
      || typeof value.tokenHash !== 'string' || typeof value.createdAt !== 'string'
      || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))
      || (record.payload.version === RECORD_VERSION && !isNasRole(value.role))) {
      throw new Error('client-connection: NAS device credential record contains an invalid device')
    }
    devices.push({
      id: value.id,
      name: value.name,
      tokenHash: value.tokenHash,
      createdAt: value.createdAt,
      expiresAt: value.expiresAt,
      role: record.payload.version === 1 ? 'admin' : isNasRole(value.role) ? value.role : 'admin',
    })
  }
  return {
    version: RECORD_VERSION,
    ...(typeof record.payload.instanceId === 'string' ? { instanceId: record.payload.instanceId } : {}),
    ...(typeof record.payload.consumedPairingHash === 'string' ? { consumedPairingHash: record.payload.consumedPairingHash } : {}),
    ...(record.payload.version === 1 || record.payload.rolesMigrated === true ? { rolesMigrated: true } : {}),
    devices,
  }
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function matchesHash(token: string, expected: string): boolean {
  const actualBytes = Buffer.from(tokenHash(token), 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array)
    total += chunk.length
    if (total > MAX_PAIRING_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function generatedCode(): string {
  return String(randomInt(0, 100_000_000)).padStart(8, '0')
}

function normalizeCode(value: string): string {
  const code = value.replaceAll(/\s/gu, '')
  if (!/^[0-9]{8}$/u.test(code)) throw new TypeError('pairing code must contain 8 digits')
  return code
}

/** Issue a single-use administrator invitation from a trusted server-local command.
 * @param credentials - the NAS server's credential provider, never a remote client provider.
 * @returns the temporary code and its expiry for local display.
 */
export async function createNasAdministratorRecovery(credentials: CredentialProvider): Promise<{ code: string; expiresAt: string }> {
  const code = generatedCode()
  const expiresAt = new Date(Date.now() + PAIRING_LIFETIME_MS).toISOString()
  await credentials.modifyRecord(RECOVERY_KEY, () => Promise.resolve({
    kind: 'grant', payload: { tokenHash: tokenHash(code), expiresAt },
  }))
  return { code, expiresAt }
}

function deviceSummary(device: DeviceRecord): NasDeviceSummary {
  return { id: device.id, name: device.name, createdAt: device.createdAt, expiresAt: device.expiresAt, role: device.role }
}

/** One deployment-wide NAS access owner. */
export class NasAccess {
  /** Fixed NAS Wire Protocol v1 routes mounted by the Web host adapter. */
  readonly routes: readonly WebRoute[]
  private pairingCode: string
  private pairingExpiresAt: number
  private pairingAttempts = 0
  private devices: readonly DeviceRecord[] = []
  private instanceId = ''
  private pairingRole: NasRole = 'admin'
  private rolesMigrated = false
  private readonly listeners = new Set<(deviceId: string) => Promise<void>>()

  private constructor(
    private readonly credentials: CredentialProvider,
    private readonly config: NasDeploymentConfig,
  ) {
    this.pairingCode = normalizeCode(config.pairingCode ?? generatedCode())
    this.pairingExpiresAt = Date.now() + PAIRING_LIFETIME_MS
    this.routes = [
      { kind: 'exact', path: NAS_PROTOCOL_V1.health.path, handler: (req: IncomingMessage, res: ServerResponse) => { this.health(req, res) } },
      { kind: 'exact', path: NAS_PROTOCOL_V1.pair.path, handler: (req: IncomingMessage, res: ServerResponse) => this.pair(req, res) },
      { kind: 'exact', path: NAS_PROTOCOL_V1.devices.path, handler: (req: IncomingMessage, res: ServerResponse) => this.managementResponse(res, () => this.manageDevices(req, res)) },
      { kind: 'exact', path: '/nas/invitations', handler: (req: IncomingMessage, res: ServerResponse) => this.invite(req, res) },
      { kind: 'exact', path: '/nas/device-role', handler: (req: IncomingMessage, res: ServerResponse) => this.managementResponse(res, () => this.changeRole(req, res)) },
      { kind: 'exact', path: '/nas/me', handler: (req: IncomingMessage, res: ServerResponse) => {
        if (!isTrustedApiRequest(req, this.config.trustedHosts)) { res.writeHead(403); res.end(); return }
        const device = this.authenticate(req)
        if (device === undefined) { res.writeHead(401); res.end(); return }
        json(res, 200, { ...deviceSummary(device), ...(device.role === 'admin' && this.rolesMigrated ? { rolesMigrated: true } : {}) })
      } },
    ]
  }

  /**
   * Restore the NAS identity and current Paired Devices from credentials.
   * @param credentials - persistent credential provider for identity and token hashes.
   * @param config - resolved NAS deployment values.
   * @returns initialized deployment-wide access owner.
   */
  static async create(credentials: CredentialProvider, config: NasDeploymentConfig): Promise<NasAccess> {
    const access = new NasAccess(credentials, config)
    const original = await credentials.readRecord(DEVICE_RECORD_KEY)
    const stored = parseDocument(original)
    if (original?.kind === 'grant' && isRecord(original.payload) && original.payload.version === 1) {
      await credentials.modifyRecord(LEGACY_BACKUP_KEY, existing => Promise.resolve(existing === undefined ? original : undefined))
      await credentials.modifyRecord(DEVICE_RECORD_KEY, current => Promise.resolve({ kind: 'grant', payload: parseDocument(current) }))
    }
    access.instanceId = stored.instanceId ?? randomBytes(16).toString('hex')
    if (stored.instanceId === undefined) {
      await credentials.modifyRecord(DEVICE_RECORD_KEY, current => Promise.resolve({
        kind: 'grant',
        payload: { ...parseDocument(current), instanceId: access.instanceId },
      }))
    }
    access.devices = stored.devices
    access.rolesMigrated = stored.rolesMigrated === true
    if (config.pairingCode !== undefined && stored.consumedPairingHash === tokenHash(normalizeCode(config.pairingCode))) {
      access.pairingExpiresAt = 0
    } else access.announcePairingCode()
    return access
  }

  /**
   * Check whether a current Paired Device bearer token authorizes a request.
   * @param req - request or fetch-style headers carrying optional authorization.
   * @returns true only for an unexpired stored token hash.
   */
  isAuthenticated(
    req: IncomingMessage | { readonly headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>> },
  ): boolean {
    return this.authenticate(req) !== undefined
  }

  /** Resolve a bearer token against live device state on every request.
   * @param req - request carrying an optional bearer token.
   * @returns an unexpired device, or undefined after invalidation.
   */
  authenticate(
    req: { readonly headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>> },
  ): DeviceRecord | undefined {
    const headerValue: unknown = req.headers instanceof Headers
      ? req.headers.get('authorization') ?? undefined
      : req.headers.authorization
    const header: unknown = Array.isArray(headerValue) ? (headerValue as unknown[])[0] : headerValue
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return undefined
    const token = header.slice('Bearer '.length)
    const now = Date.now()
    return this.devices.find(device => Date.parse(device.expiresAt) > now && matchesHash(token, device.tokenHash))
  }

  /** Read current unexpired device permissions without exposing credential material.
   * @param id - server-issued device identity.
   * @returns current public device state, absent after revocation or expiry.
   */
  device(id: string): NasDeviceSummary | undefined {
    const device = this.devices.find(value => value.id === id && Date.parse(value.expiresAt) > Date.now())
    return device === undefined ? undefined : deviceSummary(device)
  }

  /** Subscribe to committed revocations and role changes.
   * @param listener - closes the device's peers before the management response completes.
   * @returns disposer removing the subscription.
   */
  onChanged(listener: (deviceId: string) => Promise<void>): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Generate an administrator invitation from a trusted server-local caller.
   * @returns temporary single-use code; no remote recovery route exists.
   */
  recoverAdministrator(): string {
    this.pairingRole = 'admin'
    this.rotatePairingCode()
    return this.pairingCode
  }

  /**
   * Return current Paired Devices without credential hashes.
   * @returns renderer-safe summaries of current Paired Devices.
   */
  listDevices(): readonly NasDeviceSummary[] {
    return this.devices.map(deviceSummary)
  }

  private health(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== NAS_PROTOCOL_V1.health.method && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
    if (!isTrustedApiRequest(req, this.config.trustedHosts)) { res.writeHead(403); res.end('forbidden'); return }
    const available = Date.now() < this.pairingExpiresAt && this.pairingAttempts < MAX_PAIRING_ATTEMPTS
    const fields: NasHealthFields = {
      instanceId: this.instanceId,
      name: this.config.name,
      version: this.config.version,
      protocolVersion: this.config.protocolVersion,
      platform: 'linux',
      architecture: process.arch === 'arm64' ? 'arm64' : 'x64',
      pairingAvailable: available,
      ...(available ? { pairingExpiresAt: new Date(this.pairingExpiresAt).toISOString() } : {}),
    }
    if (req.method === 'HEAD') { res.writeHead(200, { 'cache-control': 'no-store' }); res.end(); return }
    json(res, 200, NAS_PROTOCOL_V1.health.response.create(fields))
  }

  private async pair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== NAS_PROTOCOL_V1.pair.method) { res.writeHead(405); res.end(); return }
    if (!isTrustedApiRequest(req, this.config.trustedHosts)) { res.writeHead(403); res.end('forbidden'); return }
    let body: unknown
    try { body = await readJson(req) } catch { json(res, 400, { error: 'invalid JSON request' }); return }
    let request
    try { request = NAS_PROTOCOL_V1.pair.request.parse(body) } catch (error) {
      if (!(error instanceof NasProtocolViolation)) throw error
      json(res, 400, { error: 'code and deviceName are required' }); return
    }
    const code = request.code.replaceAll(/\s/gu, '')
    const deviceName = request.deviceName.trim()
    const recoveryReceipt = randomBytes(16).toString('hex')
    const recoveryRecord = await this.credentials.modifyRecord(RECOVERY_KEY, (stored) => {
      if (stored?.kind !== 'grant' || !isRecord(stored.payload)
        || typeof stored.payload.tokenHash !== 'string' || typeof stored.payload.expiresAt !== 'string'
        || Date.parse(stored.payload.expiresAt) <= Date.now() || !matchesHash(code, stored.payload.tokenHash)) {
        return Promise.resolve(undefined)
      }
      return Promise.resolve({ kind: 'grant', payload: { consumed: true, receipt: recoveryReceipt } })
    })
    const recovery = recoveryRecord?.kind === 'grant' && isRecord(recoveryRecord.payload)
      && recoveryRecord.payload.receipt === recoveryReceipt
    if (!recovery && this.pairingAttempts >= MAX_PAIRING_ATTEMPTS) {
      json(res, 429, { error: 'pairing attempt limit reached; request a fresh code' }); return
    }
    if (!recovery && (Date.now() >= this.pairingExpiresAt || code.length !== this.pairingCode.length
      || !timingSafeEqual(Buffer.from(code), Buffer.from(this.pairingCode)))) {
      this.pairingAttempts += 1
      json(res, 401, { error: 'pairing code is invalid or expired' }); return
    }
    if (deviceName.length < 1 || deviceName.length > 80) { json(res, 400, { error: 'invalid device name' }); return }
    const token = randomBytes(TOKEN_BYTES).toString('base64url')
    const createdAt = new Date()
    const expiresAt = new Date(createdAt.getTime() + this.config.deviceLifetimeDays * 24 * 60 * 60 * 1000)
    const device: DeviceRecord = {
      id: randomBytes(16).toString('hex'), name: deviceName, tokenHash: tokenHash(token),
      createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(),
      role: recovery ? 'admin' : this.pairingRole,
    }
    this.pairingExpiresAt = 0
    const record = await this.credentials.modifyRecord(DEVICE_RECORD_KEY, (current: CredentialRecord | undefined) => {
      const document = parseDocument(current)
      return Promise.resolve({
        kind: 'grant' as const,
        payload: { ...document, instanceId: this.instanceId, devices: [...document.devices, device],
          ...(!recovery ? { consumedPairingHash: tokenHash(code) } : {}) },
      })
    })
    this.devices = parseDocument(record).devices
    console.info(`dsh nas: paired device ${device.id} (${device.name}); grant expires ${device.expiresAt}`)
    this.pairingExpiresAt = 0
    json(res, 200, NAS_PROTOCOL_V1.pair.response.create({
      deviceId: device.id,
      token,
      expiresAt: device.expiresAt,
      role: device.role,
      health: NAS_PROTOCOL_V1.health.response.create({
        instanceId: this.instanceId,
        name: this.config.name,
        version: this.config.version,
        protocolVersion: this.config.protocolVersion,
        platform: 'linux',
        architecture: process.arch === 'arm64' ? 'arm64' : 'x64',
        pairingAvailable: false,
      }),
    }))
  }

  private async manageDevices(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isTrustedApiRequest(req, this.config.trustedHosts)) { res.writeHead(403); res.end('forbidden'); return }
    if (!this.requireAdministrator(req, res)) return
    if (req.method === NAS_PROTOCOL_V1.devices.method) {
      json(res, 200, NAS_PROTOCOL_V1.devices.response.create(this.listDevices()))
      return
    }
    if (req.method !== NAS_PROTOCOL_V1.revokeDevice.method) { res.writeHead(405); res.end(); return }
    let body: unknown
    try { body = await readJson(req) } catch { json(res, 400, { error: 'invalid JSON request' }); return }
    let request
    try { request = NAS_PROTOCOL_V1.revokeDevice.request.parse(body) } catch (error) {
      if (!(error instanceof NasProtocolViolation)) throw error
      json(res, 400, { error: 'revokeDeviceId is required' }); return
    }
    const id = request.revokeDeviceId
    const record = await this.credentials.modifyRecord(DEVICE_RECORD_KEY, (current: CredentialRecord | undefined) => {
      const document = parseDocument(current)
      this.guardLastAdministrator(document, id)
      return Promise.resolve({
        kind: 'grant' as const,
        payload: { ...document, devices: document.devices.filter(device => device.id !== id) },
      })
    })
    this.devices = parseDocument(record).devices
    await this.changed(id)
    console.info(`dsh nas: revoked device ${id}`)
    json(res, 200, NAS_PROTOCOL_V1.devices.response.create(this.listDevices()))
  }

  private requireAdministrator(req: IncomingMessage, res: ServerResponse): boolean {
    const device = this.authenticate(req)
    if (device === undefined) { json(res, 401, { error: 'unauthorized' }); return false }
    if (device.role !== 'admin') { json(res, 403, { error: 'administrator permission required' }); return false }
    return true
  }

  private guardLastAdministrator(document: DeviceDocument, id: string): void {
    const now = Date.now()
    const admins = document.devices.filter(device => device.role === 'admin' && Date.parse(device.expiresAt) > now)
    if (admins.length === 1 && admins[0]?.id === id) throw new LastAdministratorError('cannot remove the last active NAS administrator')
  }

  private async managementResponse(res: ServerResponse, run: () => Promise<void>): Promise<void> {
    try { await run() } catch (error) {
      if (!(error instanceof LastAdministratorError)) throw error
      json(res, 409, { error: error.message })
    }
  }

  private async changed(id: string): Promise<void> {
    await Promise.all([...this.listeners].map(listener => listener(id)))
  }

  private async invite(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isTrustedApiRequest(req, this.config.trustedHosts)) { res.writeHead(403); res.end(); return }
    if (!this.requireAdministrator(req, res)) return
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
    let body: unknown
    try { body = await readJson(req) } catch { json(res, 400, { error: 'invalid JSON request' }); return }
    const role = isRecord(body) && body.role !== undefined ? body.role : 'user'
    if (!isNasRole(role)) { json(res, 400, { error: 'invalid device role' }); return }
    this.pairingRole = role
    this.rotatePairingCode()
    json(res, 200, { code: this.pairingCode, role, expiresAt: new Date(this.pairingExpiresAt).toISOString() })
  }

  private async changeRole(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isTrustedApiRequest(req, this.config.trustedHosts)) { res.writeHead(403); res.end(); return }
    if (!this.requireAdministrator(req, res)) return
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
    let body: unknown
    try { body = await readJson(req) } catch { json(res, 400, { error: 'invalid JSON request' }); return }
    if (!isRecord(body) || typeof body.deviceId !== 'string' || !isNasRole(body.role)) {
      json(res, 400, { error: 'deviceId and valid role required' }); return
    }
    const id = body.deviceId
    const role = body.role
    const record = await this.credentials.modifyRecord(DEVICE_RECORD_KEY, (current) => {
      const document = parseDocument(current)
      if (role !== 'admin') this.guardLastAdministrator(document, id)
      return Promise.resolve({ kind: 'grant', payload: {
        ...document, devices: document.devices.map(device => device.id === id ? { ...device, role } : device),
      } })
    })
    this.devices = parseDocument(record).devices
    await this.changed(id)
    json(res, 200, NAS_PROTOCOL_V1.devices.response.create(this.listDevices()))
  }

  private rotatePairingCode(): void {
    this.pairingCode = generatedCode()
    this.pairingExpiresAt = Date.now() + PAIRING_LIFETIME_MS
    this.pairingAttempts = 0
    this.announcePairingCode()
  }

  private announcePairingCode(): void {
    console.log(`dsh nas: pairing code ${this.pairingCode.slice(0, 4)} ${this.pairingCode.slice(4)} (expires ${new Date(this.pairingExpiresAt).toISOString()})`)
  }
}
