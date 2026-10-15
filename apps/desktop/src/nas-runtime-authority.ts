/** Desktop authority for selecting, pairing, authorizing, and connecting to NAS runtimes. */

import type {
  DesktopRuntimeSelection,
  NasDeviceSummary,
  NasDiscoveryCandidate,
  NasHealth,
  NasInvitation,
  NasRole,
  NasPairingRequest,
  NasPairingResponse,
  NasRuntimeRecord,
  NasRuntimeStatus,
  NasRuntimeStore,
} from './nas-runtime.ts'
import { normalizeNasBaseUrl } from './nas-runtime.ts'

/** Runtime fixed for the lifetime of one Desktop process. A selection change takes effect after restart. */
export type DesktopBootRuntime =
  | { readonly kind: 'local' }
  | { readonly kind: 'nas'; readonly runtime: NasRuntimeRecord }

/** Operations initiated by the narrow NAS settings bridge. */
export type NasRuntimeOperation =
  | { readonly kind: 'discover' }
  | { readonly kind: 'inspect-certificate'; readonly baseUrl: string }
  | { readonly kind: 'pair'; readonly request: NasPairingRequest }
  | { readonly kind: 'select'; readonly selection: DesktopRuntimeSelection }
  | { readonly kind: 'remove'; readonly serverId: string }
  | { readonly kind: 'test'; readonly serverId: string }
  | { readonly kind: 'list-devices'; readonly serverId: string }
  | { readonly kind: 'me'; readonly serverId: string }
  | { readonly kind: 'invite'; readonly serverId: string; readonly role: NasRole }
  | { readonly kind: 'set-device-role'; readonly serverId: string; readonly deviceId: string; readonly role: NasRole }
  | { readonly kind: 'revoke-device'; readonly serverId: string; readonly deviceId: string }

interface NasRuntimeOperationResults {
  readonly discover: readonly NasDiscoveryCandidate[]
  readonly 'inspect-certificate': { readonly fingerprint: string }
  readonly pair: NasRuntimeStatus
  readonly select: { readonly restarting: true }
  readonly remove: NasRuntimeStatus
  readonly test: { readonly healthy: true; readonly version: string }
  readonly 'list-devices': readonly NasDeviceSummary[]
  readonly me: NasDeviceSummary
  readonly invite: NasInvitation
  readonly 'set-device-role': readonly NasDeviceSummary[]
  readonly 'revoke-device': readonly NasDeviceSummary[]
}

/** Result selected by one operation's discriminant. */
export type NasRuntimeOperationResult<Operation extends NasRuntimeOperation> =
  NasRuntimeOperationResults[Operation['kind']]

/** Network operations hidden behind the authority seam. */
export interface NasRuntimeNetworkAdapter {
  discover(): Promise<readonly NasDiscoveryCandidate[]>
  inspectCertificate(baseUrl: string): Promise<string>
  health(baseUrl: string, token: string): Promise<NasHealth>
  pair(request: NasPairingRequest): Promise<NasPairingResponse>
  devices(baseUrl: string, token: string): Promise<readonly NasDeviceSummary[]>
  me(baseUrl: string, token: string): Promise<NasDeviceSummary>
  invite(baseUrl: string, token: string, role: NasRole): Promise<NasInvitation>
  setDeviceRole(baseUrl: string, token: string, deviceId: string, role: NasRole): Promise<readonly NasDeviceSummary[]>
  revokeDevice(baseUrl: string, token: string, deviceId: string): Promise<readonly NasDeviceSummary[]>
}

/** Captured window target for one asynchronous NAS connection attempt. */
export interface NasRuntimeConnectionTarget {
  isCurrent(runtime: NasRuntimeRecord): boolean
  load(baseUrl: string): Promise<void>
}

/** Electron presentation effects whose ordering is owned by the authority. */
export interface NasRuntimeConnectionAdapter {
  capture(): NasRuntimeConnectionTarget | undefined
  begin(runtime: NasRuntimeRecord): void
  ready(runtime: NasRuntimeRecord): void
  fail(runtime: NasRuntimeRecord, error: Error): Promise<void>
}

/** Lifecycle effects required after durable runtime changes. */
export interface NasRuntimeLifecycleAdapter {
  stopActiveProfileServices(): Promise<void>
  restartAfter(delayMs: number): void
}

export interface NasRuntimeAuthorityOptions {
  readonly store: NasRuntimeStore
  readonly network: NasRuntimeNetworkAdapter
  readonly connection: NasRuntimeConnectionAdapter
  readonly lifecycle: NasRuntimeLifecycleAdapter
  readonly publishStatus: (status: NasRuntimeStatus) => void
  readonly now?: () => number
}

/** Deep owner of Desktop NAS policy; Electron code only adapts host events to this interface. */
export class DesktopNasRuntimeAuthority {
  readonly bootRuntime: DesktopBootRuntime
  readonly #pendingCertificatePins = new Map<string, string>()
  readonly #now: () => number

  constructor(private readonly options: NasRuntimeAuthorityOptions) {
    const active = options.store.status().active
    this.bootRuntime = active === undefined ? { kind: 'local' } : { kind: 'nas', runtime: active }
    this.#now = options.now ?? Date.now
  }

  /** Read renderer-safe status without exposing credentials or pending pins. */
  status(): NasRuntimeStatus { return this.options.store.status() }

  /** Execute one validated NAS settings operation. */
  async execute<Operation extends NasRuntimeOperation>(
    operation: Operation,
  ): Promise<NasRuntimeOperationResult<Operation>> {
    switch (operation.kind) {
      case 'discover':
        return await this.options.network.discover() as NasRuntimeOperationResult<Operation>
      case 'inspect-certificate': {
        const baseUrl = normalizeNasBaseUrl(operation.baseUrl)
        const fingerprint = await this.options.network.inspectCertificate(baseUrl)
        this.#pendingCertificatePins.set(baseUrl, fingerprint)
        return { fingerprint } as NasRuntimeOperationResult<Operation>
      }
      case 'pair': {
        const baseUrl = normalizeNasBaseUrl(operation.request.baseUrl)
        const expected = this.#pendingCertificatePins.get(baseUrl)
        if (expected === undefined || expected !== operation.request.certificateFingerprint) {
          throw new Error('desktop: inspect and confirm the current NAS certificate before pairing')
        }
        const pairing = await this.options.network.pair({ ...operation.request, baseUrl })
        this.#pendingCertificatePins.delete(baseUrl)
        return this.#publish(this.options.store.savePairing(
          baseUrl,
          pairing,
          operation.request.certificateFingerprint,
        )) as NasRuntimeOperationResult<Operation>
      }
      case 'select': {
        this.#publish(this.options.store.select(operation.selection))
        await this.options.lifecycle.stopActiveProfileServices()
        this.options.lifecycle.restartAfter(250)
        return { restarting: true } as NasRuntimeOperationResult<Operation>
      }
      case 'remove':
        return this.#publish(this.options.store.remove(operation.serverId)) as NasRuntimeOperationResult<Operation>
      case 'test': {
        const { server, credential } = this.#requireAccess(operation.serverId, 'desktop: NAS device credential is unavailable')
        const health = await this.options.network.health(server.baseUrl, credential.token)
        return { healthy: true, version: health.version } as NasRuntimeOperationResult<Operation>
      }
      case 'list-devices': {
        const { server, credential } = this.#requireAccess(operation.serverId, 'desktop: NAS credential is unavailable')
        return await this.options.network.devices(
          server.baseUrl,
          credential.token,
        ) as NasRuntimeOperationResult<Operation>
      }
      case 'me': {
        const { server, credential } = this.#requireAccess(operation.serverId, 'desktop: NAS credential is unavailable')
        return await this.options.network.me(server.baseUrl, credential.token) as NasRuntimeOperationResult<Operation>
      }
      case 'invite': {
        const { server, credential } = this.#requireAccess(operation.serverId, 'desktop: NAS credential is unavailable')
        return await this.options.network.invite(server.baseUrl, credential.token, operation.role) as NasRuntimeOperationResult<Operation>
      }
      case 'set-device-role': {
        const { server, credential } = this.#requireAccess(operation.serverId, 'desktop: NAS credential is unavailable')
        return await this.options.network.setDeviceRole(
          server.baseUrl, credential.token, operation.deviceId, operation.role,
        ) as NasRuntimeOperationResult<Operation>
      }
      case 'revoke-device': {
        const { server, credential } = this.#requireAccess(operation.serverId, 'desktop: NAS credential is unavailable')
        const devices = await this.options.network.revokeDevice(
          server.baseUrl,
          credential.token,
          operation.deviceId,
        )
        if (credential.deviceId === operation.deviceId) {
          this.#publish(this.options.store.remove(operation.serverId))
          this.options.lifecycle.restartAfter(250)
        }
        return devices as NasRuntimeOperationResult<Operation>
      }
    }
  }

  /** Connect the NAS selected when this Desktop process started. */
  async connectSelected(): Promise<void> {
    const runtime = this.bootRuntime.kind === 'nas' ? this.bootRuntime.runtime : undefined
    const target = this.options.connection.capture()
    if (runtime === undefined || target === undefined) {
      throw new Error('desktop: selected NAS runtime is unavailable')
    }
    const credential = this.options.store.credential(runtime.id)
    if (credential === undefined) throw new Error('desktop: the selected NAS has no usable device credential; pair it again')
    if (runtime.credentialExpiresAt !== undefined && Date.parse(runtime.credentialExpiresAt) <= this.#now()) {
      throw new Error('desktop: the selected NAS device credential has expired; pair it again')
    }
    this.options.connection.begin(runtime)
    try {
      const health = await this.options.network.health(runtime.baseUrl, credential.token)
      if (health.instanceId !== runtime.id) {
        throw new Error('desktop: the NAS identity changed since pairing; remove it and pair again')
      }
      if (!target.isCurrent(runtime)) return
      this.options.connection.ready(runtime)
      await target.load(runtime.baseUrl)
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      await this.options.connection.fail(runtime, normalized)
      throw normalized
    }
  }

  /** Decide whether Electron may accept one failed TLS certificate validation. */
  acceptsCertificate(url: string, observedFingerprint: string): boolean {
    let origin: string
    try { origin = new URL(url).origin } catch { return false }
    const saved = this.options.store.read().servers.find(server => server.baseUrl === origin)?.certificateFingerprint
    const pending = this.#pendingCertificatePins.get(origin)
    const observed = observedFingerprint.toUpperCase()
    return observed === saved || observed === pending
  }

  /** Add a bearer credential only for the exact currently selected NAS origin. */
  authorizeRequestHeaders(
    url: string,
    headers: Readonly<Record<string, string>>,
  ): Readonly<Record<string, string>> {
    let origin: string
    try { origin = new URL(url).origin } catch { return headers }
    const directory = this.options.store.read()
    const selectedServerId = directory.selection.kind === 'nas' ? directory.selection.serverId : undefined
    const active = selectedServerId === undefined
      ? undefined
      : directory.servers.find(server => server.id === selectedServerId)
    const credential = active?.baseUrl === origin ? this.options.store.credential(active.id) : undefined
    return credential === undefined ? headers : { ...headers, Authorization: `Bearer ${credential.token}` }
  }

  #publish(status: NasRuntimeStatus): NasRuntimeStatus {
    this.options.publishStatus(status)
    return status
  }

  #requireAccess(serverId: string, message: string) {
    const server = this.options.store.read().servers.find(candidate => candidate.id === serverId)
    const credential = this.options.store.credential(serverId)
    if (server === undefined || credential === undefined) throw new Error(message)
    return { server, credential }
  }
}
