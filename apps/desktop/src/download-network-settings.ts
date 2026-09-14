/** Validated desktop-only routing for application and plugin downloads. */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type DownloadProxyMode = 'existing' | 'system' | 'direct' | 'custom'
export type ApplicationUpdateSource = 'github' | 'cnb'
export type NpmRegistryMode = 'npmjs' | 'npmmirror' | 'custom'
export type GithubDownloadMode = 'original' | 'custom'
export type DownloadNetworkTarget = 'application' | 'npm' | 'github'
export type DownloadNetworkTestStage = 'metadata' | 'download'

export type DownloadNetworkTestStatus =
  | { phase: 'idle' }
  | { phase: 'testing'; target: DownloadNetworkTarget; stage: DownloadNetworkTestStage }
  | { phase: 'succeeded'; target: DownloadNetworkTarget; stage: DownloadNetworkTestStage; elapsedMs: number }
  | { phase: 'failed'; target: DownloadNetworkTarget; stage: DownloadNetworkTestStage; message: string }

export interface DownloadProxySettings {
  mode: DownloadProxyMode
  url?: string
  username?: string
  passwordSet: boolean
}

export interface DownloadNetworkSettings {
  schema: 'open-dsh-desktop/download-network/v1'
  revision: number
  application: { source: ApplicationUpdateSource; proxy: DownloadProxySettings }
  npm: { registry: NpmRegistryMode; registryUrl?: string; proxy: DownloadProxySettings }
  github: { download: GithubDownloadMode; acceleratorUrl?: string; proxy: DownloadProxySettings }
}

export interface DownloadNetworkPatch {
  target: DownloadNetworkTarget
  application?: { source: ApplicationUpdateSource; proxy: Omit<DownloadProxySettings, 'passwordSet'>; password?: string }
  npm?: { registry: NpmRegistryMode; registryUrl?: string; proxy: Omit<DownloadProxySettings, 'passwordSet'>; password?: string }
  github?: { download: GithubDownloadMode; acceleratorUrl?: string; proxy: Omit<DownloadProxySettings, 'passwordSet'>; password?: string }
}

export interface SecretEncryption {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

/** Main-process-only snapshot used to freeze one package operation's routing. */
export interface DownloadNetworkOperationSnapshot {
  settings: DownloadNetworkSettings
  passwords: Partial<Record<DownloadNetworkTarget, string>>
}

interface PersistedSettings {
  schema: DownloadNetworkSettings['schema']
  revision: number
  application: Omit<DownloadNetworkSettings['application'], 'proxy'> & { proxy: Omit<DownloadProxySettings, 'passwordSet'> }
  npm: Omit<DownloadNetworkSettings['npm'], 'proxy'> & { proxy: Omit<DownloadProxySettings, 'passwordSet'> }
  github: Omit<DownloadNetworkSettings['github'], 'proxy'> & { proxy: Omit<DownloadProxySettings, 'passwordSet'> }
  secrets?: Partial<Record<DownloadNetworkTarget, string>>
}

export const DEFAULT_DOWNLOAD_NETWORK_SETTINGS: DownloadNetworkSettings = Object.freeze({
  schema: 'open-dsh-desktop/download-network/v1', revision: 0,
  application: { source: 'github', proxy: { mode: 'system', passwordSet: false } },
  npm: { registry: 'npmmirror', proxy: { mode: 'existing', passwordSet: false } },
  github: { download: 'original', proxy: { mode: 'existing', passwordSet: false } },
} satisfies DownloadNetworkSettings)

function normalizeHttpsUrl(value: unknown, label: string): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > 2_048 || value.includes('\\')) throw new TypeError(`${label} must be an HTTPS URL`)
  const parsed = new URL(value.trim())
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
    throw new TypeError(`${label} must be an HTTPS URL without credentials, query, or fragment`)
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/u, '')}`
}

function normalizeProxyUrl(value: unknown, mode: DownloadProxyMode): string | undefined {
  if (mode !== 'custom') return undefined
  if (typeof value !== 'string' || value.length > 2_048 || value.includes('\\')) throw new TypeError('Custom proxy URL is required')
  const parsed = new URL(value.trim())
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username !== '' || parsed.password !== ''
    || parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new TypeError('Custom proxy must be an HTTP or HTTPS URL without embedded credentials')
  }
  return parsed.origin
}

function normalizeUsername(value: unknown, mode: DownloadProxyMode): string | undefined {
  if (mode !== 'custom' || value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > 256 || /[\r\n]/u.test(value)) throw new TypeError('Proxy username is invalid')
  return value
}

function normalizeProxy(value: unknown, allowed: readonly DownloadProxyMode[]): Omit<DownloadProxySettings, 'passwordSet'> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Proxy settings must be an object')
  const source = value as Record<string, unknown>
  if (typeof source.mode !== 'string' || !allowed.includes(source.mode as DownloadProxyMode)) throw new TypeError('Proxy mode is invalid')
  const mode = source.mode as DownloadProxyMode
  const url = normalizeProxyUrl(source.url, mode)
  const username = normalizeUsername(source.username, mode)
  return { mode, ...(url === undefined ? {} : { url }), ...(username === undefined ? {} : { username }) }
}

function normalizeSecrets(value: unknown): PersistedSettings['secrets'] {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Download secrets are invalid')
  const source = value as Record<string, unknown>
  if (Object.keys(source).some(key => !['application', 'npm', 'github'].includes(key))) {
    throw new TypeError('Download secrets contain an unknown target')
  }
  const secrets: Partial<Record<DownloadNetworkTarget, string>> = {}
  for (const target of ['application', 'npm', 'github'] as const) {
    const encrypted = source[target]
    if (encrypted === undefined) continue
    if (typeof encrypted !== 'string' || encrypted.length > 16_384 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encrypted)) {
      throw new TypeError('Download secret payload is invalid')
    }
    secrets[target] = encrypted
  }
  return Object.keys(secrets).length === 0 ? undefined : secrets
}

function copyDefaults(): DownloadNetworkSettings {
  return JSON.parse(JSON.stringify(DEFAULT_DOWNLOAD_NETWORK_SETTINGS)) as DownloadNetworkSettings
}

function publicSettings(persisted: PersistedSettings, memorySecrets: ReadonlyMap<DownloadNetworkTarget, string>): DownloadNetworkSettings {
  const passwordSet = (target: DownloadNetworkTarget): boolean => persisted.secrets?.[target] !== undefined || memorySecrets.has(target)
  return {
    schema: persisted.schema, revision: persisted.revision,
    application: { ...persisted.application, proxy: { ...persisted.application.proxy, passwordSet: passwordSet('application') } },
    npm: { ...persisted.npm, proxy: { ...persisted.npm.proxy, passwordSet: passwordSet('npm') } },
    github: { ...persisted.github, proxy: { ...persisted.github.proxy, passwordSet: passwordSet('github') } },
  }
}

function persistedDefaults(): PersistedSettings {
  const defaults = copyDefaults()
  return {
    schema: defaults.schema, revision: defaults.revision,
    application: { source: defaults.application.source, proxy: { mode: defaults.application.proxy.mode } },
    npm: { registry: defaults.npm.registry, proxy: { mode: defaults.npm.proxy.mode } },
    github: { download: defaults.github.download, proxy: { mode: defaults.github.proxy.mode } },
  }
}

function withoutSecret(
  secrets: PersistedSettings['secrets'],
  target: DownloadNetworkTarget,
): PersistedSettings['secrets'] {
  if (secrets === undefined) return undefined
  const { application, npm, github } = secrets
  const retained = {
    ...(target === 'application' || application === undefined ? {} : { application }),
    ...(target === 'npm' || npm === undefined ? {} : { npm }),
    ...(target === 'github' || github === undefined ? {} : { github }),
  }
  return Object.keys(retained).length === 0 ? undefined : retained
}

/** JSON store that never returns a saved proxy password to a renderer. */
export class DownloadNetworkSettingsStore {
  #settings: PersistedSettings
  readonly #memorySecrets = new Map<DownloadNetworkTarget, string>()
  readonly #history = new Map<number, {
    settings: PersistedSettings
    memorySecrets: ReadonlyMap<DownloadNetworkTarget, string>
  }>()

  constructor(
    readonly filePath: string,
    readonly encryption: SecretEncryption,
    readonly reportReadFailure: (error: unknown) => void = () => {},
  ) {
    this.#settings = this.#read()
  }

  #read(): PersistedSettings {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new TypeError('Download network settings must be an object')
      const source = raw as Record<string, unknown>
      if (source.schema !== 'open-dsh-desktop/download-network/v1') throw new TypeError('Unsupported download network settings schema')
      const application = source.application as Record<string, unknown>
      const npm = source.npm as Record<string, unknown>
      const github = source.github as Record<string, unknown>
      const appSource = application.source
      const registry = npm.registry
      const download = github.download
      if (appSource !== 'github' && appSource !== 'cnb') throw new TypeError('Invalid application update source')
      if (!['existing', 'npmjs', 'npmmirror', 'custom'].includes(String(registry))) throw new TypeError('Invalid npm registry')
      if (download !== 'original' && download !== 'custom') throw new TypeError('Invalid GitHub download mode')
      const registryUrl = registry === 'custom' ? normalizeHttpsUrl(npm.registryUrl, 'npm registry URL') : undefined
      const acceleratorUrl = download === 'custom' ? normalizeHttpsUrl(github.acceleratorUrl, 'GitHub accelerator URL') : undefined
      const secrets = normalizeSecrets(source.secrets)
      return {
        schema: source.schema, revision: Number.isSafeInteger(source.revision) ? Number(source.revision) : 0,
        application: { source: appSource, proxy: normalizeProxy(application.proxy, ['system', 'direct', 'custom']) },
        npm: { registry: registry === 'existing' ? 'npmmirror' : registry as NpmRegistryMode,
          ...(registryUrl === undefined ? {} : { registryUrl }),
          proxy: normalizeProxy(npm.proxy, ['existing', 'direct', 'custom']) },
        github: { download,
          ...(acceleratorUrl === undefined ? {} : { acceleratorUrl }),
          proxy: normalizeProxy(github.proxy, ['existing', 'direct', 'custom']) },
        ...(secrets === undefined ? {} : { secrets }),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.reportReadFailure(error)
      return persistedDefaults()
    }
  }

  read(): DownloadNetworkSettings { return publicSettings(this.#settings, this.#memorySecrets) }

  operationSnapshot(revision: number): DownloadNetworkOperationSnapshot | undefined {
    const retained = revision === this.#settings.revision
      ? { settings: this.#settings, memorySecrets: this.#memorySecrets }
      : this.#history.get(revision)
    if (retained === undefined) return undefined
    const passwords: Partial<Record<DownloadNetworkTarget, string>> = {}
    for (const target of ['application', 'npm', 'github'] as const) {
      const memory = retained.memorySecrets.get(target)
      if (memory !== undefined) { passwords[target] = memory; continue }
      const encrypted = retained.settings.secrets?.[target]
      if (encrypted === undefined || !this.encryption.available()) continue
      try { passwords[target] = this.encryption.decrypt(Buffer.from(encrypted, 'base64')) }
      catch (error) { this.reportReadFailure(error) }
    }
    return { settings: publicSettings(retained.settings, retained.memorySecrets), passwords }
  }

  #retainCurrent(): void {
    this.#history.set(this.#settings.revision, {
      settings: structuredClone(this.#settings),
      memorySecrets: new Map(this.#memorySecrets),
    })
    while (this.#history.size > 16) {
      const oldest = this.#history.keys().next().value
      if (oldest === undefined) break
      this.#history.delete(oldest)
    }
  }

  password(target: DownloadNetworkTarget): string | undefined {
    const memory = this.#memorySecrets.get(target)
    if (memory !== undefined) return memory
    const saved = this.#settings.secrets?.[target]
    if (saved === undefined || !this.encryption.available()) return undefined
    try { return this.encryption.decrypt(Buffer.from(saved, 'base64')) } catch (error) { this.reportReadFailure(error); return undefined }
  }

  update(raw: unknown): DownloadNetworkSettings {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new TypeError('Download network patch must be an object')
    const patch = raw as DownloadNetworkPatch
    if (!['application', 'npm', 'github'].includes(patch.target)) throw new TypeError('Download network target is invalid')
    const next = { ...this.#settings, revision: this.#settings.revision + 1 }
    const value = patch[patch.target] as Record<string, unknown> | undefined
    if (value === undefined) throw new TypeError(`Missing ${patch.target} settings`)
    if (patch.target === 'application') {
      if (value.source !== 'github' && value.source !== 'cnb') throw new TypeError('Application update source is invalid')
      next.application = { source: value.source, proxy: normalizeProxy(value.proxy, ['system', 'direct', 'custom']) }
    } else if (patch.target === 'npm') {
      if (!['npmjs', 'npmmirror', 'custom'].includes(String(value.registry))) throw new TypeError('npm registry is invalid')
      const registryUrl = value.registry === 'custom' ? normalizeHttpsUrl(value.registryUrl, 'npm registry URL') : undefined
      next.npm = { registry: value.registry as NpmRegistryMode,
        ...(registryUrl === undefined ? {} : { registryUrl }),
        proxy: normalizeProxy(value.proxy, ['existing', 'direct', 'custom']) }
    } else {
      if (value.download !== 'original' && value.download !== 'custom') throw new TypeError('GitHub download mode is invalid')
      const acceleratorUrl = value.download === 'custom' ? normalizeHttpsUrl(value.acceleratorUrl, 'GitHub accelerator URL') : undefined
      next.github = { download: value.download,
        ...(acceleratorUrl === undefined ? {} : { acceleratorUrl }),
        proxy: normalizeProxy(value.proxy, ['existing', 'direct', 'custom']) }
    }
    this.#retainCurrent()
    const password = value.password
    if (password !== undefined) {
      if (typeof password !== 'string' || password.length > 1_024 || /[\r\n]/u.test(password)) throw new TypeError('Proxy password is invalid')
      this.#memorySecrets.delete(patch.target)
      const encrypted = password === '' || !this.encryption.available()
        ? undefined : this.encryption.encrypt(password).toString('base64')
      const secrets = withoutSecret(next.secrets, patch.target)
      if (encrypted !== undefined) next.secrets = { ...secrets, [patch.target]: encrypted }
      else if (secrets === undefined) delete next.secrets
      else next.secrets = secrets
      if (password !== '' && !this.encryption.available()) this.#memorySecrets.set(patch.target, password)
    }
    this.#settings = next
    this.#write()
    return this.read()
  }

  reset(target: DownloadNetworkTarget): DownloadNetworkSettings {
    const defaults = persistedDefaults()
    const next = { ...this.#settings, revision: this.#settings.revision + 1, [target]: defaults[target] }
    this.#retainCurrent()
    const secrets = withoutSecret(next.secrets, target)
    this.#memorySecrets.delete(target)
    if (secrets === undefined) delete next.secrets
    else next.secrets = secrets
    this.#settings = next
    this.#write()
    return this.read()
  }

  #write(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(this.#settings, undefined, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, this.filePath)
  }
}

/** Resolve the selected npm registry. */
export function npmRegistryUrl(settings: DownloadNetworkSettings['npm']): string | undefined {
  if (settings.registry === 'npmjs') return 'https://registry.npmjs.org'
  if (settings.registry === 'npmmirror') return 'https://registry.npmmirror.com'
  return settings.registryUrl
}
