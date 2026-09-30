/**
 * Versioned fixed-route JSON protocol shared by NAS Runtime and Desktop
 * adapters. Transport, authorization, TLS, and Runtime selection remain owned
 * by those adapters.
 *
 * @module @deepseek-ai/dsh-nas-protocol
 */

const HEALTH_SCHEMA = 'open-deepseek-harness/nas-health/v1' as const
const PAIRING_SCHEMA = 'open-deepseek-harness/nas-pairing/v1' as const

/** Health document returned by a NAS Runtime. */
export interface NasHealthDocument {
  readonly schema: typeof HEALTH_SCHEMA
  readonly instanceId: string
  readonly name: string
  readonly version: string
  readonly protocolVersion: number
  readonly platform: 'linux'
  readonly architecture: 'x64' | 'arm64'
  readonly pairingAvailable: boolean
  readonly pairingExpiresAt?: string
}

/** JSON body accepted by the pairing route. */
export interface NasPairRequest {
  readonly code: string
  readonly deviceName: string
}

/** Pairing document returned after creating a Paired Device. */
export interface NasPairingDocument {
  readonly schema: typeof PAIRING_SCHEMA
  readonly deviceId: string
  readonly token: string
  readonly expiresAt: string
  readonly health: NasHealthDocument
}

/** Renderer-safe summary of one Paired Device. */
export interface NasDeviceSummary {
  readonly id: string
  readonly name: string
  readonly createdAt: string
  readonly expiresAt: string
}

/** JSON document returned by both device-management operations. */
export interface NasDevicesDocument {
  readonly devices: readonly NasDeviceSummary[]
}

/** JSON body accepted when revoking a Paired Device. */
export interface NasRevokeDeviceRequest {
  readonly revokeDeviceId: string
}

/** Fields supplied by the NAS Runtime when constructing a health document. */
export type NasHealthFields = Omit<NasHealthDocument, 'schema'>

/** Fields supplied by the NAS Runtime when constructing a pairing document. */
export type NasPairingFields = Omit<NasPairingDocument, 'schema'>

/** Raised when JSON at the NAS wire seam violates the v1 document format. */
export class NasProtocolViolation extends Error {
  override readonly name = 'NasProtocolViolation'

  /**
   * Create a protocol-format failure without retaining the rejected payload.
   * @param document - v1 document kind that failed validation.
   */
  constructor(readonly document: 'health' | 'pair-request' | 'pairing' | 'devices' | 'revoke-device-request') {
    super(`NAS protocol v1 returned an invalid ${document} document`)
  }
}

interface Codec<T, CreateInput = T> {
  create(input: CreateInput): T
  parse(raw: unknown): T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function parseHealth(raw: unknown): NasHealthDocument {
  if (!isRecord(raw) || raw.schema !== HEALTH_SCHEMA
    || !nonEmpty(raw.instanceId) || !nonEmpty(raw.name) || !nonEmpty(raw.version)
    || typeof raw.protocolVersion !== 'number' || !Number.isFinite(raw.protocolVersion)
    || raw.platform !== 'linux' || (raw.architecture !== 'x64' && raw.architecture !== 'arm64')
    || typeof raw.pairingAvailable !== 'boolean'
    || (raw.pairingExpiresAt !== undefined && !isoDate(raw.pairingExpiresAt))) {
    throw new NasProtocolViolation('health')
  }
  return {
    schema: HEALTH_SCHEMA,
    instanceId: raw.instanceId,
    name: raw.name,
    version: raw.version,
    protocolVersion: raw.protocolVersion,
    platform: raw.platform,
    architecture: raw.architecture,
    pairingAvailable: raw.pairingAvailable,
    ...(raw.pairingExpiresAt === undefined ? {} : { pairingExpiresAt: raw.pairingExpiresAt }),
  }
}

function parsePairRequest(raw: unknown): NasPairRequest {
  if (!isRecord(raw) || typeof raw.code !== 'string' || typeof raw.deviceName !== 'string') {
    throw new NasProtocolViolation('pair-request')
  }
  return { code: raw.code, deviceName: raw.deviceName }
}

function parsePairing(raw: unknown): NasPairingDocument {
  if (!isRecord(raw) || raw.schema !== PAIRING_SCHEMA || !nonEmpty(raw.deviceId)
    || !nonEmpty(raw.token) || raw.token.length < 32 || !isoDate(raw.expiresAt)) {
    throw new NasProtocolViolation('pairing')
  }
  let health: NasHealthDocument
  try {
    health = parseHealth(raw.health)
  } catch {
    throw new NasProtocolViolation('pairing')
  }
  return { schema: PAIRING_SCHEMA, deviceId: raw.deviceId, token: raw.token, expiresAt: raw.expiresAt, health }
}

function parseDevice(raw: unknown): NasDeviceSummary {
  if (!isRecord(raw) || !nonEmpty(raw.id) || !nonEmpty(raw.name)
    || !isoDate(raw.createdAt) || !isoDate(raw.expiresAt)) {
    throw new NasProtocolViolation('devices')
  }
  return { id: raw.id, name: raw.name, createdAt: raw.createdAt, expiresAt: raw.expiresAt }
}

function parseDevices(raw: unknown): NasDevicesDocument {
  if (!isRecord(raw) || !Array.isArray(raw.devices)) throw new NasProtocolViolation('devices')
  return { devices: raw.devices.map(parseDevice) }
}

function parseRevokeRequest(raw: unknown): NasRevokeDeviceRequest {
  if (!isRecord(raw) || typeof raw.revokeDeviceId !== 'string') {
    throw new NasProtocolViolation('revoke-device-request')
  }
  return { revokeDeviceId: raw.revokeDeviceId }
}

const healthCodec: Codec<NasHealthDocument, NasHealthFields> = {
  create: input => parseHealth({ schema: HEALTH_SCHEMA, ...input }),
  parse: parseHealth,
}
const pairRequestCodec: Codec<NasPairRequest> = { create: parsePairRequest, parse: parsePairRequest }
const pairingCodec: Codec<NasPairingDocument, NasPairingFields> = {
  create: input => parsePairing({ schema: PAIRING_SCHEMA, ...input }),
  parse: parsePairing,
}
const devicesCodec: Codec<NasDevicesDocument, readonly NasDeviceSummary[]> = {
  create: devices => parseDevices({ devices }),
  parse: parseDevices,
}
const revokeRequestCodec: Codec<NasRevokeDeviceRequest> = { create: parseRevokeRequest, parse: parseRevokeRequest }

/**
 * Complete NAS wire protocol v1 interface. Adapters use its methods, paths,
 * and codecs instead of restating route or JSON knowledge.
 */
export const NAS_PROTOCOL_V1 = Object.freeze({
  version: 1 as const,
  health: Object.freeze({ method: 'GET' as const, path: '/nas/health' as const, response: healthCodec }),
  pair: Object.freeze({ method: 'POST' as const, path: '/nas/pair' as const, request: pairRequestCodec, response: pairingCodec }),
  devices: Object.freeze({ method: 'GET' as const, path: '/nas/devices' as const, response: devicesCodec }),
  revokeDevice: Object.freeze({ method: 'POST' as const, path: '/nas/devices' as const, request: revokeRequestCodec, response: devicesCodec }),
})
