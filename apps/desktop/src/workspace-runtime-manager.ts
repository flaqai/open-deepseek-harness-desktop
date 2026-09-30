/** Download, verification, shared-cache, and per-Profile state for optional workspace runtimes. */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, posix, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { t, x } from 'tar'
import {
  WORKSPACE_RUNTIME_CAPABILITIES,
  type WorkspaceRuntimeArtifact,
  type WorkspaceRuntimeCapability,
  type WorkspaceRuntimeManifest,
  type WorkspaceRuntimeOfficeArtifact,
  type WorkspaceRuntimeTarget,
} from './workspace-runtime-manifest.ts'
import { PythonEnvironment, type PythonEnvironmentPort, type PythonEnvironmentProbe, type PythonPackagePlan } from './workspace-python-environment.ts'
import runtimeLock from '../scripts/primary-runtime-lock.json' with { type: 'json' }

export type WorkspaceRuntimePhase =
  | 'not-installed' | 'downloading' | 'paused' | 'verifying' | 'waiting-restart'
  | 'enabled' | 'needs-update' | 'cleaning' | 'failed' | 'unsupported' | 'nas-unavailable'

export interface WorkspaceRuntimeCapabilityStatus {
  readonly capabilityId: WorkspaceRuntimeCapability
  readonly phase: WorkspaceRuntimePhase
  readonly message?: string
  readonly jobId?: string
  readonly transferredBytes?: number
  readonly totalBytes?: number
  readonly percent?: number
}

export interface WorkspaceRuntimeSnapshot {
  readonly currentHome: string
  readonly target?: WorkspaceRuntimeTarget
  readonly sharedPayload?: { readonly payloadDigest: string; readonly path: string; readonly desktopVersion: string }
  readonly python: { readonly source: 'managed' | 'custom'; readonly probe?: PythonEnvironmentProbe; readonly plan?: PythonPackagePlan }
  readonly capabilities: Readonly<Record<WorkspaceRuntimeCapability, WorkspaceRuntimeCapabilityStatus>>
}

export interface WorkspaceRuntimeJobSnapshot {
  readonly jobId: string
  readonly capabilityId: WorkspaceRuntimeCapability
  readonly phase: 'running' | 'paused' | 'succeeded' | 'cancelled' | 'failed'
  readonly stage: 'resolving' | 'downloading' | 'verifying' | 'extracting' | 'ready'
  readonly transferredBytes: number
  readonly totalBytes?: number
  readonly percent?: number
  readonly message?: string
}

export interface WorkspaceRuntimeOutputRead {
  readonly text: string
  readonly nextOffset: number
  readonly lossy: boolean
  readonly settled: boolean
}

interface RuntimeReference {
  payloadDigest: string
  officePayloadDigest?: string
  desktopVersion: string
  state: 'pending-enable' | 'enabled' | 'pending-remove' | 'cleaning'
  source?: 'managed' | 'custom'
  python?: string
}

interface HomeRecord {
  python?: PythonEnvironmentProbe
  office?: RuntimeReference
  ptc?: RuntimeReference
}

interface PersistedState {
  schema: 'open-dsh-desktop/workspace-runtimes/v2'
  homes: Record<string, HomeRecord>
  pendingCleanup: string[]
}

interface Job {
  snapshot: WorkspaceRuntimeJobSnapshot
  artifact?: DownloadArtifact
  controller?: AbortController
  output: string
  outputBase: number
  completion?: Promise<void>
}

interface DownloadArtifact {
  readonly fileName: string
  readonly size: number
  readonly sha256?: string
  readonly payloadDigest: string
  readonly githubUrl?: string
  readonly cnbUrl?: string
  readonly url?: string
  readonly integrity?: string
}

export interface OptionalRuntimeManagerOptions {
  readonly cacheRoot: string
  readonly stateFile: string
  readonly desktopVersion: string
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly getHome: () => string
  readonly isNas: () => boolean
  readonly source: () => 'github' | 'cnb'
  readonly loadManifest: () => Promise<WorkspaceRuntimeManifest>
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
  /** Installed target-specific archives. Python uses this source before any network route. */
  readonly bundledArtifactsRoot?: string
  /** Installed Harness node_modules containing the platform Office engine; a resolver follows archive extraction. */
  readonly bundledOfficeNodeModules?: string | (() => string)
  /** Treat a missing bundled Python archive as an invalid application installation. */
  readonly requireBundledPython?: boolean
  readonly target?: WorkspaceRuntimeTarget
  readonly maxOutputBytes?: number
  readonly pythonEnvironment?: PythonEnvironmentPort
}

const MAX_ARCHIVE_ENTRIES = 100_000
const MAX_EXTRACTED_BYTES = 4 * 1024 * 1024 * 1024

function emptyState(): PersistedState {
  return { schema: 'open-dsh-desktop/workspace-runtimes/v2', homes: {}, pendingCleanup: [] }
}

function normalizedHome(home: string): string {
  return normalize(resolve(home))
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('desktop: invalid workspace-runtime state')
  }
  return value as Record<string, unknown>
}

function reference(value: unknown): RuntimeReference | undefined {
  if (value === undefined) return undefined
  const record = object(value)
  if (Object.keys(record).some(key => !['payloadDigest', 'officePayloadDigest', 'desktopVersion', 'state', 'source', 'python'].includes(key))
    || typeof record.payloadDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(record.payloadDigest)
    || (record.officePayloadDigest !== undefined
      && (typeof record.officePayloadDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(record.officePayloadDigest)))
    || typeof record.desktopVersion !== 'string'
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(record.desktopVersion)
    || (record.state !== 'pending-enable' && record.state !== 'enabled'
      && record.state !== 'pending-remove' && record.state !== 'cleaning')
    || (record.source !== undefined && record.source !== 'managed' && record.source !== 'custom')
    || (record.python !== undefined && typeof record.python !== 'string')) {
    throw new TypeError('desktop: invalid workspace-runtime state')
  }
  return {
    payloadDigest: record.payloadDigest,
    ...(record.officePayloadDigest === undefined ? {} : { officePayloadDigest: record.officePayloadDigest }),
    desktopVersion: record.desktopVersion,
    state: record.state,
    ...(record.source === undefined ? {} : { source: record.source }),
    ...(record.python === undefined ? {} : { python: record.python }),
  }
}

function persistedState(value: unknown): PersistedState {
  const root = object(value)
  if (root.schema !== 'open-dsh-desktop/workspace-runtimes/v1' && root.schema !== 'open-dsh-desktop/workspace-runtimes/v2') {
    throw new TypeError('desktop: invalid workspace-runtime state')
  }
  const homesSource = object(root.homes)
  const homes: Record<string, HomeRecord> = {}
  for (const [home, value] of Object.entries(homesSource)) {
    if (normalizedHome(home) !== home) throw new TypeError('desktop: invalid workspace-runtime state')
    const source = object(value)
    if (Object.keys(source).some(key => key !== 'python' && !WORKSPACE_RUNTIME_CAPABILITIES.includes(key as WorkspaceRuntimeCapability))) {
      throw new TypeError('desktop: invalid workspace-runtime state')
    }
    const pythonRecord = source.python === undefined ? undefined : object(source.python)
    let python: PythonEnvironmentProbe | undefined
    if (pythonRecord !== undefined) {
      const { implementation, executable, requestedPath, version, architecture, pipVersion, sitePackages, writable } = pythonRecord
      const packageValue = pythonRecord.packages
      if (implementation !== 'CPython' || typeof executable !== 'string'
        || typeof requestedPath !== 'string' || typeof version !== 'string'
        || typeof architecture !== 'string' || typeof pipVersion !== 'string'
        || typeof sitePackages !== 'string' || typeof writable !== 'boolean'
        || packageValue === null || typeof packageValue !== 'object' || Array.isArray(packageValue)) {
        throw new TypeError('desktop: invalid workspace-runtime Python selection')
      }
      const packageEntries: [string, string][] = []
      for (const [name, value] of Object.entries(packageValue)) {
        if (typeof value !== 'string') throw new TypeError('desktop: invalid workspace-runtime Python selection')
        packageEntries.push([name, value])
      }
      python = {
        implementation, executable, requestedPath, version, architecture, pipVersion, sitePackages, writable,
        packages: Object.fromEntries(packageEntries),
      }
    }
    const record = { office: reference(source.office), ptc: reference(source.ptc) }
    homes[home] = {
      ...(python === undefined ? {} : { python }),
      ...(record.office === undefined ? {} : { office: record.office }),
      ...(record.ptc === undefined ? {} : { ptc: record.ptc }),
    }
  }
  if (!Array.isArray(root.pendingCleanup)
    || !root.pendingCleanup.every(value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value))
    || new Set(root.pendingCleanup).size !== root.pendingCleanup.length) {
    throw new TypeError('desktop: invalid workspace-runtime state')
  }
  return { schema: 'open-dsh-desktop/workspace-runtimes/v2', homes, pendingCleanup: root.pendingCleanup as string[] }
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function cloneSnapshot(job: Job): WorkspaceRuntimeJobSnapshot {
  return { ...job.snapshot }
}

/** Deep module that hides all optional-runtime persistence and archive handling from IPC callers. */
export class OptionalRuntimeManager {
  readonly #options: OptionalRuntimeManagerOptions
  readonly #jobs = new Map<string, Job>()
  #state: PersistedState | undefined
  readonly #python: PythonEnvironmentPort

  constructor(options: OptionalRuntimeManagerOptions) {
    this.#options = options
    this.#python = options.pythonEnvironment ?? new PythonEnvironment()
  }

  async #readState(): Promise<PersistedState> {
    if (this.#state !== undefined) return this.#state
    try {
      const state = persistedState(JSON.parse(await readFile(this.#options.stateFile, 'utf8')))
      this.#state = state
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      this.#state = emptyState()
    }
    return this.#state
  }

  async #writeState(): Promise<void> {
    const state = await this.#readState()
    await mkdir(dirname(this.#options.stateFile), { recursive: true })
    const temporary = `${this.#options.stateFile}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.#options.stateFile)
  }

  #target(): WorkspaceRuntimeTarget | undefined { return this.#options.target }

  #supported(capability: WorkspaceRuntimeCapability): boolean {
    if (this.#target() === undefined) return false
    return capability !== 'ptc' || this.#options.platform === 'darwin' || this.#options.platform === 'linux'
  }

  async get(): Promise<WorkspaceRuntimeSnapshot> {
    const home = normalizedHome(this.#options.getHome())
    const state = await this.#readState()
    const record = state.homes[home] ?? {}
    const target = this.#target()
    const currentArtifact = target !== undefined && this.#options.requireBundledPython === true
      ? (await this.#options.loadManifest()).artifacts[target]
      : undefined
    const currentJob = (capability: WorkspaceRuntimeCapability): Job | undefined => [...this.#jobs.values()].reverse()
      .find(job => job.snapshot.capabilityId === capability
        && !['succeeded', 'cancelled'].includes(job.snapshot.phase))
    const capability = (capabilityId: WorkspaceRuntimeCapability): WorkspaceRuntimeCapabilityStatus => {
      if (this.#options.isNas()) return { capabilityId, phase: 'nas-unavailable' }
      if (!this.#supported(capabilityId)) return { capabilityId, phase: 'unsupported' }
      const job = currentJob(capabilityId)
      if (job !== undefined) return {
        capabilityId,
        phase: job.snapshot.phase === 'failed' ? 'failed'
          : job.snapshot.phase === 'paused' ? 'paused'
            : job.snapshot.stage === 'verifying' ? 'verifying'
              : job.snapshot.phase === 'running' ? 'downloading' : 'not-installed',
        ...(job.snapshot.message === undefined ? {} : { message: job.snapshot.message }),
        jobId: job.snapshot.jobId,
        transferredBytes: job.snapshot.transferredBytes,
        ...(job.snapshot.totalBytes === undefined ? {} : { totalBytes: job.snapshot.totalBytes }),
        ...(job.snapshot.percent === undefined ? {} : { percent: job.snapshot.percent }),
      }
      const reference = record[capabilityId]
      if (reference === undefined) return { capabilityId, phase: 'not-installed' }
      if (reference.state === 'cleaning') return { capabilityId, phase: 'cleaning' }
      if (reference.state === 'pending-remove') {
        return { capabilityId, phase: 'waiting-restart' }
      }
      if (capabilityId === 'office' && this.#options.bundledOfficeNodeModules === undefined
        && reference.officePayloadDigest === undefined) {
        return { capabilityId, phase: 'needs-update' }
      }
      if (reference.state === 'pending-enable') return { capabilityId, phase: 'waiting-restart' }
      if (reference.source !== 'custom' && currentArtifact !== undefined
        && reference.payloadDigest !== currentArtifact.payloadDigest) {
        return { capabilityId, phase: 'needs-update' }
      }
      if (capabilityId === 'office' && this.#options.bundledOfficeNodeModules === undefined && currentArtifact !== undefined
        && reference.officePayloadDigest !== currentArtifact.office.payloadDigest) {
        return { capabilityId, phase: 'needs-update' }
      }
      return { capabilityId, phase: 'enabled' }
    }
    const reference = [record.office, record.ptc].find(value => value?.state !== 'cleaning' && value?.source !== 'custom')
    const python = record.python
    return {
      currentHome: home,
      ...(target === undefined ? {} : { target }),
      ...(reference === undefined ? {} : {
        sharedPayload: {
          payloadDigest: reference.payloadDigest,
          path: join(this.#options.cacheRoot, reference.payloadDigest, target ?? 'unsupported'),
          desktopVersion: reference.desktopVersion,
        },
      }),
      python: python === undefined
        ? { source: 'managed' }
        : { source: 'custom', probe: python, plan: this.#python.plan(python, runtimeLock.pythonPackages) },
      capabilities: { office: capability('office'), ptc: capability('ptc') },
    }
  }

  async selectCustomPython(path: string): Promise<WorkspaceRuntimeSnapshot> {
    if (this.#options.isNas()) throw new Error('desktop: Python selection is managed by the NAS runtime')
    const probe = await this.#python.probe(path)
    const state = await this.#readState()
    const record = state.homes[normalizedHome(this.#options.getHome())] ??= {}
    record.python = probe
    for (const capability of WORKSPACE_RUNTIME_CAPABILITIES) {
      const value = record[capability]
      if (value?.source !== 'custom' && value !== undefined && !state.pendingCleanup.includes(value.payloadDigest)) {
        state.pendingCleanup.push(value.payloadDigest)
      }
      if (value?.officePayloadDigest !== undefined && !state.pendingCleanup.includes(value.officePayloadDigest)) {
        state.pendingCleanup.push(value.officePayloadDigest)
      }
      if (value !== undefined) record[capability] = { ...value, state: 'pending-remove' }
    }
    await this.#writeState()
    return this.get()
  }

  async selectManagedPython(): Promise<WorkspaceRuntimeSnapshot> {
    if (this.#options.isNas()) throw new Error('desktop: Python selection is managed by the NAS runtime')
    const state = await this.#readState()
    const record = state.homes[normalizedHome(this.#options.getHome())] ??= {}
    delete record.python
    for (const capability of WORKSPACE_RUNTIME_CAPABILITIES) {
      const value = record[capability]
      if (value?.source === 'custom') record[capability] = { ...value, state: 'pending-remove' }
    }
    await this.#writeState()
    return this.get()
  }

  async installCustomOffice(allowPackageChanges: boolean): Promise<WorkspaceRuntimeSnapshot> {
    const state = await this.#readState()
    const record = state.homes[normalizedHome(this.#options.getHome())] ??= {}
    if (record.python === undefined) throw new Error('desktop: no custom Python environment is selected')
    record.python = await this.#python.install(record.python, runtimeLock.pythonPackages, allowPackageChanges)
    await this.#writeState()
    return this.get()
  }

  start(capabilityId: WorkspaceRuntimeCapability): Promise<WorkspaceRuntimeJobSnapshot> {
    try {
      this.#assertCapability(capabilityId)
      if (this.#options.isNas()) throw new Error('desktop: workspace runtimes are unavailable in NAS mode')
      if (!this.#supported(capabilityId)) throw new Error('desktop: workspace runtime capability is unsupported on this platform')
      const existing = [...this.#jobs.values()].find(job => job.snapshot.capabilityId === capabilityId
        && (job.snapshot.phase === 'running' || job.snapshot.phase === 'paused'))
      if (existing !== undefined) {
        if (existing.snapshot.phase === 'paused') this.#resume(existing)
        return Promise.resolve(cloneSnapshot(existing))
      }
      if ([...this.#jobs.values()].some(job => job.snapshot.phase === 'running' || job.snapshot.phase === 'paused')) {
        throw new Error('desktop: another workspace-runtime download is active')
      }
      const job: Job = {
        snapshot: {
          jobId: randomUUID(), capabilityId, phase: 'running', stage: 'resolving', transferredBytes: 0,
        },
        output: '', outputBase: 0,
      }
      this.#jobs.set(job.snapshot.jobId, job)
      this.#resume(job)
      return Promise.resolve(cloneSnapshot(job))
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  getJob(jobId: string): WorkspaceRuntimeJobSnapshot {
    const job = this.#requireJob(jobId)
    return cloneSnapshot(job)
  }

  readOutput(jobId: string, offset: number): WorkspaceRuntimeOutputRead {
    const job = this.#requireJob(jobId)
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError('desktop: invalid workspace-runtime output offset')
    const start = Math.max(0, offset - job.outputBase)
    return {
      text: job.output.slice(start),
      nextOffset: job.outputBase + job.output.length,
      lossy: offset < job.outputBase,
      settled: !['running', 'paused'].includes(job.snapshot.phase),
    }
  }

  async pause(jobId: string): Promise<WorkspaceRuntimeJobSnapshot> {
    const job = this.#requireJob(jobId)
    if (job.snapshot.phase === 'running') {
      job.snapshot = { ...job.snapshot, phase: 'paused' }
      job.controller?.abort('paused')
      await job.completion?.catch(() => undefined)
      this.#append(job, 'Download paused; the verified partial file is retained for resume.\n')
    }
    return cloneSnapshot(job)
  }

  async cancel(jobId: string): Promise<WorkspaceRuntimeJobSnapshot> {
    const job = this.#requireJob(jobId)
    job.snapshot = { ...job.snapshot, phase: 'cancelled' }
    job.controller?.abort('cancelled')
    await job.completion?.catch(() => undefined)
    const artifact = job.artifact
    const target = this.#target()
    if (artifact !== undefined && target !== undefined) await rm(this.#partialPath(artifact, target), { force: true })
    this.#append(job, 'Download cancelled; the partial file was removed.\n')
    return cloneSnapshot(job)
  }

  async activate(capabilityId: WorkspaceRuntimeCapability): Promise<WorkspaceRuntimeSnapshot> {
    this.#assertCapability(capabilityId)
    if (this.#options.isNas()) throw new Error('desktop: workspace runtimes are unavailable in NAS mode')
    if (!this.#supported(capabilityId)) throw new Error('desktop: workspace runtime capability is unsupported on this platform')
    const home = normalizedHome(this.#options.getHome())
    const state = await this.#readState()
    const record = state.homes[home] ??= {}
    if (record.python !== undefined && capabilityId === 'ptc') {
      const probe = await this.#python.probe(record.python.executable)
      record.python = probe
      record[capabilityId] = {
        payloadDigest: createHash('sha256').update(probe.executable).digest('hex'),
        desktopVersion: this.#options.desktopVersion, state: 'pending-enable', source: 'custom', python: probe.executable,
      }
      await this.#writeState()
      return this.get()
    }
    const manifest = await this.#options.loadManifest()
    this.#assertManifest(manifest)
    const target = this.#target() as WorkspaceRuntimeTarget
    const artifact = manifest.artifacts[target]
    const payloadRoot = this.payloadRoot(artifact)
    if (record.python === undefined) {
      if (!await exists(join(payloadRoot, 'runtime.json'))) throw new Error('desktop: workspace runtime must be downloaded before activation')
      await this.#validatePythonPayload(payloadRoot, artifact)
    }
    if (capabilityId === 'office') {
      if (this.#options.bundledOfficeNodeModules !== undefined) await this.#verifyBundledOffice(artifact.office)
      else {
        const officeRoot = this.#payloadRoot(artifact.office, target)
        if (!await exists(join(officeRoot, 'office-runtime.json'))) {
          throw new Error('desktop: official Office engine must be downloaded before activation')
        }
        await this.#validateOfficePayload(officeRoot, artifact.office, target)
      }
    }
    if (state.pendingCleanup.includes(artifact.payloadDigest)) {
      await this.#collectUnused()
      if (state.pendingCleanup.includes(artifact.payloadDigest)) {
        throw new Error('desktop: workspace runtime is waiting for cleanup and cannot be re-enabled')
      }
      if (!await exists(join(payloadRoot, 'runtime.json'))) {
        throw new Error('desktop: workspace runtime must be downloaded again after cleanup')
      }
    }
    if (record.python !== undefined) {
      const probe = await this.#python.probe(record.python.executable)
      if (this.#python.plan(probe, runtimeLock.pythonPackages).changes.length > 0) {
        throw new Error('desktop: Office dependencies are not installed in the selected Python environment')
      }
      record.python = probe
    }
    const previous = record[capabilityId]
    if (previous !== undefined && previous.payloadDigest !== artifact.payloadDigest
      && !state.pendingCleanup.includes(previous.payloadDigest)) state.pendingCleanup.push(previous.payloadDigest)
    if (previous?.officePayloadDigest !== undefined && previous.officePayloadDigest !== artifact.office.payloadDigest
      && !state.pendingCleanup.includes(previous.officePayloadDigest)) state.pendingCleanup.push(previous.officePayloadDigest)
    record[capabilityId] = {
      payloadDigest: record.python === undefined
        ? artifact.payloadDigest
        : createHash('sha256').update(record.python.executable).digest('hex'),
      ...(capabilityId === 'office' && this.#options.bundledOfficeNodeModules === undefined
        ? { officePayloadDigest: artifact.office.payloadDigest } : {}),
      desktopVersion: manifest.desktopVersion,
      state: 'pending-enable',
      source: record.python === undefined ? 'managed' : 'custom',
      ...(record.python === undefined ? {} : { python: record.python.executable }),
    }
    await this.#writeState()
    return this.get()
  }

  async remove(capabilityId: WorkspaceRuntimeCapability): Promise<WorkspaceRuntimeSnapshot> {
    this.#assertCapability(capabilityId)
    if (this.#options.isNas()) throw new Error('desktop: workspace runtimes are unavailable in NAS mode')
    const home = normalizedHome(this.#options.getHome())
    const state = await this.#readState()
    const record = state.homes[home] ??= {}
    const reference = record[capabilityId]
    if (reference !== undefined) record[capabilityId] = { ...reference, state: 'pending-remove' }
    await this.#writeState()
    return this.get()
  }

  async pending(home = this.#options.getHome()): Promise<Readonly<Record<WorkspaceRuntimeCapability, 'enable' | 'remove' | undefined>>> {
    const record = (await this.#readState()).homes[normalizedHome(home)] ?? {}
    const pending = (capability: WorkspaceRuntimeCapability): 'enable' | 'remove' | undefined => {
      const state = record[capability]?.state
      return state === 'pending-enable' ? 'enable' : state === 'pending-remove' ? 'remove' : undefined
    }
    return { office: pending('office'), ptc: pending('ptc') }
  }

  async reference(
    home: string,
    capability: WorkspaceRuntimeCapability,
  ): Promise<{ payloadRoot: string; desktopVersion: string; python?: PythonEnvironmentProbe; custom?: boolean } | undefined> {
    const target = this.#target()
    const value = (await this.#readState()).homes[normalizedHome(home)]?.[capability]
    if (value === undefined || value.state === 'cleaning' || target === undefined) return undefined
    if (value.source === 'custom' && value.python !== undefined) {
      const probe = (await this.#readState()).homes[normalizedHome(home)]?.python
      if (probe === undefined) return undefined
      return {
        payloadRoot: dirname(value.python),
        desktopVersion: value.desktopVersion,
        python: probe,
        custom: true,
      }
    }
    return { payloadRoot: join(this.#options.cacheRoot, value.payloadDigest, target), desktopVersion: value.desktopVersion }
  }

  async officeNodeModules(home = this.#options.getHome()): Promise<string | undefined> {
    if (this.#options.bundledOfficeNodeModules !== undefined) {
      const manifest = await this.#options.loadManifest()
      this.#assertManifest(manifest)
      const target = this.#target()
      if (target === undefined) return undefined
      try {
        return await this.#verifyBundledOffice(manifest.artifacts[target].office)
      } catch (error) {
        console.warn('desktop: optional bundled Office engine is unavailable during startup', error)
        return undefined
      }
    }
    const target = this.#target()
    const value = (await this.#readState()).homes[normalizedHome(home)]?.office
    if (target === undefined || value === undefined || value.state === 'pending-remove' || value.state === 'cleaning') return undefined
    if (value.officePayloadDigest === undefined) return undefined
    return join(this.#options.cacheRoot, value.officePayloadDigest, target, 'office', 'node_modules')
  }

  async #verifyBundledOffice(artifact: WorkspaceRuntimeOfficeArtifact): Promise<string> {
    const configured = this.#options.bundledOfficeNodeModules
    const nodeModules = typeof configured === 'function' ? configured() : configured
    if (nodeModules === undefined) throw new Error('desktop: bundled Office engine path is unavailable')
    const kitPath = join(nodeModules, '@deepseek-ai', 'libreoffice-kit', 'package.json')
    const kit = JSON.parse(await readFile(kitPath, 'utf8')) as {
      version?: string
      optionalDependencies?: Record<string, string>
    }
    const native = `@deepseek-ai/libreoffice-kit-${this.#options.platform}-${this.#options.arch}`
    const enginePackage = Object.hasOwn(kit.optionalDependencies ?? {}, native)
      ? native : '@deepseek-ai/libreoffice-kit-wasm'
    if (kit.version !== artifact.engineVersion || enginePackage !== artifact.enginePackage
      || kit.optionalDependencies?.[enginePackage] !== kit.version) {
      throw new Error(`desktop: bundled Office engine identity does not match ${artifact.enginePackage}@${artifact.engineVersion}`)
    }
    const engineRoot = join(nodeModules, ...enginePackage.split('/'))
    const engine = JSON.parse(await readFile(join(engineRoot, 'package.json'), 'utf8')) as {
      name?: string
      version?: string
    }
    if (engine.name !== enginePackage || engine.version !== kit.version
      || !await exists(join(engineRoot, 'prebuilds.json'))) {
      throw new Error(`desktop: bundled Office engine ${enginePackage}@${kit.version} is incomplete`)
    }
    return nodeModules
  }

  async commitPending(home = this.#options.getHome()): Promise<void> {
    const key = normalizedHome(home)
    const state = await this.#readState()
    const record = state.homes[key]
    if (record === undefined) return
    for (const capability of WORKSPACE_RUNTIME_CAPABILITIES) {
      const reference = record[capability]
      if (reference?.state === 'pending-enable') record[capability] = { ...reference, state: 'enabled' }
      else if (reference?.state === 'pending-remove') {
        if (reference.source === 'custom') {
          if (reference.officePayloadDigest !== undefined && !state.pendingCleanup.includes(reference.officePayloadDigest)) {
            state.pendingCleanup.push(reference.officePayloadDigest)
          }
          if (capability === 'office') delete record.office
          else delete record.ptc
        }
        else {
          if (!state.pendingCleanup.includes(reference.payloadDigest)) state.pendingCleanup.push(reference.payloadDigest)
          if (reference.officePayloadDigest !== undefined && !state.pendingCleanup.includes(reference.officePayloadDigest)) {
            state.pendingCleanup.push(reference.officePayloadDigest)
          }
          record[capability] = { ...reference, state: 'cleaning' }
        }
      }
    }
    await this.#writeState()
    await this.#collectUnused()
  }

  payloadRoot(artifact: WorkspaceRuntimeArtifact): string {
    return this.#payloadRoot(artifact, artifact.target)
  }

  #payloadRoot(artifact: DownloadArtifact, target: WorkspaceRuntimeTarget): string {
    return join(this.#options.cacheRoot, artifact.payloadDigest, target)
  }

  async dispose(): Promise<void> {
    for (const job of this.#jobs.values()) job.controller?.abort('desktop shutdown')
    await Promise.allSettled([...this.#jobs.values()].flatMap(job => job.completion === undefined ? [] : [job.completion]))
  }

  #resume(job: Job): void {
    job.snapshot = { ...job.snapshot, phase: 'running' }
    const controller = new AbortController()
    job.controller = controller
    job.completion = this.#run(job, controller.signal).catch((error: unknown) => {
      if (job.snapshot.phase === 'paused' || job.snapshot.phase === 'cancelled') return
      job.snapshot = { ...job.snapshot, phase: 'failed', message: error instanceof Error ? error.message : String(error) }
      this.#append(job, `Failed: ${job.snapshot.message ?? 'unknown error'}\n`)
    })
  }

  async #run(job: Job, signal: AbortSignal): Promise<void> {
    const manifest = await this.#options.loadManifest()
    this.#assertManifest(manifest)
    const target = this.#target() as WorkspaceRuntimeTarget
    const artifact = manifest.artifacts[target]
    const record = (await this.#readState()).homes[normalizedHome(this.#options.getHome())]
    if (record?.python === undefined || job.snapshot.capabilityId === 'ptc') {
      await this.#ensureArtifact(job, artifact, target, 'Python workspace runtime', signal,
        root => this.#validatePythonPayload(root, artifact))
    }
    if (job.snapshot.capabilityId === 'office') {
      if (this.#options.bundledOfficeNodeModules !== undefined) {
        await this.#verifyBundledOffice(artifact.office)
        this.#append(job, 'Verified the platform Office engine bundled with Desktop.\n')
      } else {
        await this.#ensureArtifact(job, artifact.office, target, 'official Office engine', signal,
          root => this.#validateOfficePayload(root, artifact.office, target))
      }
    }
    job.snapshot = { ...job.snapshot, phase: 'succeeded', stage: 'ready', percent: 100 }
    this.#append(job, 'Workspace runtime components are verified. Choose activate, then quick restart.\n')
  }

  async #ensureArtifact(
    job: Job,
    artifact: DownloadArtifact,
    target: WorkspaceRuntimeTarget,
    label: string,
    signal: AbortSignal,
    validate: (root: string) => Promise<void>,
  ): Promise<void> {
    job.artifact = artifact
    const payloadRoot = this.#payloadRoot(artifact, target)
    const office = label === 'official Office engine' ? artifact as WorkspaceRuntimeOfficeArtifact : undefined
    const metadata = office === undefined ? 'runtime.json' : 'office-runtime.json'
    if (await exists(join(payloadRoot, metadata))) {
      try {
        await validate(payloadRoot)
        job.snapshot = { ...job.snapshot, transferredBytes: artifact.size, totalBytes: artifact.size, percent: 100 }
        this.#append(job, `Verified ${label} is already present in the shared cache.\n`)
        return
      } catch {
        await rm(payloadRoot, { recursive: true, force: true })
        this.#append(job, `Discarded an incomplete ${label} before downloading a clean payload.\n`)
      }
    }
    await mkdir(join(this.#options.cacheRoot, '.downloads'), { recursive: true })
    const part = this.#partialPath(artifact, target)
    const transferred = await this.#stageArtifact(job, artifact, part, signal)
    signal.throwIfAborted()
    job.snapshot = { ...job.snapshot, stage: 'verifying', transferredBytes: transferred, totalBytes: artifact.size, percent: 100 }
    this.#append(job, `Verifying ${artifact.integrity === undefined ? 'SHA-256' : 'npm integrity'} and archive policy.\n`)
    if (transferred !== artifact.size) throw new Error(`desktop: workspace-runtime archive size mismatch (${transferred}/${artifact.size})`)
    if (artifact.sha256 !== undefined && await sha256File(part) !== artifact.sha256) {
      await rm(part, { force: true })
      throw new Error('desktop: workspace-runtime archive SHA-256 mismatch')
    }
    if (artifact.integrity !== undefined) {
      const hash = createHash('sha512')
      for await (const chunk of createReadStream(part)) hash.update(chunk as Buffer)
      if (`sha512-${hash.digest('base64')}` !== artifact.integrity) {
        await rm(part, { force: true })
        throw new Error('desktop: official Office engine npm integrity mismatch')
      }
    }
    const staging = await mkdtemp(join(this.#options.cacheRoot, '.extract-'))
    try {
      job.snapshot = { ...job.snapshot, stage: 'extracting' }
      const npm = office?.source === 'npm'
      await this.#inspectArchive(part, npm ? 'package' : 'workspace-runtime')
      await x({ file: part, cwd: staging, strict: true, preservePaths: false })
      const extracted = npm
        ? await this.#stageNpmOffice(staging, office, target)
        : join(staging, 'workspace-runtime')
      await validate(extracted)
      await mkdir(dirname(payloadRoot), { recursive: true })
      if (!await exists(payloadRoot)) await rename(extracted, payloadRoot)
      await rm(part, { force: true })
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
    job.snapshot = { ...job.snapshot, transferredBytes: artifact.size, totalBytes: artifact.size, percent: 100 }
    this.#append(job, `${label} prepared and verified.\n`)
  }

  async #stageArtifact(job: Job, artifact: DownloadArtifact, part: string, signal: AbortSignal): Promise<number> {
    const bundled = this.#options.bundledArtifactsRoot === undefined
      ? undefined
      : join(this.#options.bundledArtifactsRoot, artifact.fileName)
    if (bundled !== undefined && await exists(bundled)) {
      signal.throwIfAborted()
      await mkdir(dirname(part), { recursive: true })
      this.#append(job, `Preparing bundled ${artifact.fileName}.\n`)
      await copyFile(bundled, part)
      const transferred = (await stat(part)).size
      job.snapshot = {
        ...job.snapshot,
        stage: 'downloading',
        transferredBytes: transferred,
        totalBytes: artifact.size,
        percent: Math.min(100, Math.floor(transferred * 100 / artifact.size)),
      }
      return transferred
    }
    if (this.#options.requireBundledPython === true && artifact.sha256 !== undefined) {
      throw new Error('desktop: bundled Python workspace runtime is missing; reinstall the application')
    }
    return this.#download(job, artifact, part, signal)
  }

  async #download(job: Job, artifact: DownloadArtifact, part: string, signal: AbortSignal): Promise<number> {
    let offset = 0
    try { offset = (await stat(part)).size } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (offset > artifact.size) { await rm(part, { force: true }); offset = 0 }
    const url = artifact.url ?? (this.#options.source() === 'cnb' ? artifact.cnbUrl : artifact.githubUrl)
    if (url === undefined) throw new Error('desktop: workspace-runtime artifact has no download URL')
    this.#append(job, `${offset > 0 ? 'Resuming' : 'Downloading'} ${artifact.fileName}.\n`)
    const response = await this.#options.fetch(url, {
      signal,
      redirect: 'follow',
      headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
    })
    if (!response.ok || response.body === null) throw new Error(`desktop: workspace-runtime download returned HTTP ${response.status}`)
    const append = offset > 0 && response.status === 206
    if (append && !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)) {
      throw new Error('desktop: workspace-runtime resume response has an invalid Content-Range')
    }
    if (!append) offset = 0
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > artifact.size - offset) {
      throw new Error('desktop: workspace-runtime response exceeds the signed archive size')
    }
    job.snapshot = { ...job.snapshot, stage: 'downloading', transferredBytes: offset, totalBytes: artifact.size,
      percent: Math.floor(offset * 100 / artifact.size) }
    const reader = Readable.fromWeb(response.body as never)
    reader.on('data', (chunk: Buffer) => {
      offset += chunk.length
      job.snapshot = { ...job.snapshot, transferredBytes: offset, totalBytes: artifact.size,
        percent: Math.min(100, Math.floor(offset * 100 / artifact.size)) }
    })
    await pipeline(reader, createWriteStream(part, { flags: append ? 'a' : 'w', mode: 0o600 }), { signal })
    return offset
  }

  async #inspectArchive(path: string, root: 'workspace-runtime' | 'package'): Promise<void> {
    let entries = 0
    let bytes = 0
    await t({
      file: path,
      strict: true,
      onReadEntry: (entry) => {
        entries += 1
        bytes += entry.size
        const normalized = entry.path.replace(/\\/gu, '/')
        const relativePath = posix.relative(root, normalized)
        if (entries > MAX_ARCHIVE_ENTRIES || bytes > MAX_EXTRACTED_BYTES
          || normalized.startsWith('/') || normalized.includes('\0')
          || relativePath === '..' || relativePath.startsWith('../')
          || !['File', 'Directory'].includes(entry.type)) {
          throw new Error('desktop: workspace-runtime archive violates extraction policy')
        }
      },
    })
  }

  async #stageNpmOffice(
    staging: string,
    artifact: WorkspaceRuntimeOfficeArtifact & { readonly source: 'npm' },
    target: WorkspaceRuntimeTarget,
  ): Promise<string> {
    const packageRoot = join(staging, 'package')
    const packageManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      name?: unknown
      version?: unknown
    }
    if (packageManifest.name !== artifact.enginePackage || packageManifest.version !== artifact.engineVersion) {
      throw new Error('desktop: official Office engine npm package identity does not match the signed catalog')
    }
    const root = join(staging, 'workspace-runtime')
    const destination = join(root, 'office', 'node_modules', ...artifact.enginePackage.split('/'))
    await mkdir(dirname(destination), { recursive: true })
    await rename(packageRoot, destination)
    const [platform, arch] = target.split('-')
    await writeFile(join(root, 'office-runtime.json'), `${JSON.stringify({
      schema: 'dsh/office-runtime-payload/v1',
      desktopVersion: this.#options.desktopVersion,
      platform,
      arch,
      payloadDigest: artifact.payloadDigest,
      officeEngine: { package: artifact.enginePackage, version: artifact.engineVersion },
    }, undefined, 2)}\n`, { mode: 0o600 })
    return root
  }

  async #collectUnused(): Promise<void> {
    const state = await this.#readState()
    const retained = new Set<string>()
    for (const record of Object.values(state.homes)) {
      if (record.office !== undefined && record.office.state !== 'cleaning' && record.office.source !== 'custom') retained.add(record.office.payloadDigest)
      if (record.office?.officePayloadDigest !== undefined && record.office.state !== 'cleaning') retained.add(record.office.officePayloadDigest)
      if (record.ptc !== undefined && record.ptc.state !== 'cleaning' && record.ptc.source !== 'custom') retained.add(record.ptc.payloadDigest)
    }
    for (const digest of [...state.pendingCleanup]) {
      if (!retained.has(digest)) {
        try { await rm(join(this.#options.cacheRoot, digest), { recursive: true, force: true }) }
        catch { continue }
      }
      state.pendingCleanup = state.pendingCleanup.filter(value => value !== digest)
      for (const record of Object.values(state.homes)) {
        if (record.office?.state === 'cleaning'
          && (record.office.payloadDigest === digest || record.office.officePayloadDigest === digest)) delete record.office
        if (record.ptc?.state === 'cleaning' && record.ptc.payloadDigest === digest) delete record.ptc
      }
      state.homes = Object.fromEntries(Object.entries(state.homes)
        .filter(([, record]) => record.office !== undefined || record.ptc !== undefined))
    }
    await this.#writeState()
  }

  async #validatePythonPayload(root: string, artifact: WorkspaceRuntimeArtifact): Promise<void> {
    const value: unknown = JSON.parse(await readFile(join(root, 'runtime.json'), 'utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('desktop: workspace-runtime payload metadata is invalid')
    const manifest = value as Record<string, unknown>
    const [platform, arch] = artifact.target.split('-')
    if (manifest.schema !== 'dsh/workspace-runtime-payload/v1'
      || manifest.platform !== platform || manifest.arch !== arch
      || manifest.payloadDigest !== artifact.payloadDigest || manifest.pythonVersion !== artifact.pythonVersion) {
      throw new Error('desktop: workspace-runtime payload identity does not match the signed catalog')
    }
    const pythonRoot = join(root, 'python')
    const python = platform === 'win32' ? join(pythonRoot, 'python.exe') : join(pythonRoot, 'bin', 'python3')
    const packages = platform === 'win32'
      ? join(pythonRoot, 'Lib', 'site-packages')
      : join(pythonRoot, 'lib', `python${artifact.pythonVersion.split('.').slice(0, 2).join('.')}`, 'site-packages')
    const [pythonStat, packagesStat] = await Promise.all([lstat(python), lstat(packages)])
    if (pythonStat.isSymbolicLink() || packagesStat.isSymbolicLink()
      || !pythonStat.isFile() || !packagesStat.isDirectory()) {
      throw new Error('desktop: workspace-runtime payload is incomplete')
    }
  }

  async #validateOfficePayload(
    root: string,
    artifact: WorkspaceRuntimeOfficeArtifact,
    target: WorkspaceRuntimeTarget,
  ): Promise<void> {
    const value: unknown = JSON.parse(await readFile(join(root, 'office-runtime.json'), 'utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('desktop: workspace-runtime Office engine metadata is invalid')
    }
    const manifest = value as Record<string, unknown>
    const [platform, arch] = target.split('-')
    if (manifest.schema !== 'dsh/office-runtime-payload/v1'
      || manifest.desktopVersion !== this.#options.desktopVersion
      || manifest.platform !== platform || manifest.arch !== arch
      || manifest.payloadDigest !== artifact.payloadDigest) {
      throw new Error('desktop: workspace-runtime Office engine identity does not match the signed catalog')
    }
    const officeEngine = manifest.officeEngine
    if (officeEngine === null || typeof officeEngine !== 'object' || Array.isArray(officeEngine)) {
      throw new Error('desktop: workspace-runtime Office engine metadata is invalid')
    }
    const engine = officeEngine as Record<string, unknown>
    const expectedEngine = artifact.enginePackage
    if (engine.package !== expectedEngine || engine.version !== artifact.engineVersion) {
      throw new Error('desktop: workspace-runtime Office engine does not match this platform')
    }
    const engineManifest = JSON.parse(await readFile(join(root, 'office', 'node_modules', ...expectedEngine.split('/'), 'package.json'), 'utf8')) as {
      name?: unknown
      version?: unknown
    }
    if (engineManifest.name !== expectedEngine || engineManifest.version !== engine.version) {
      throw new Error('desktop: workspace-runtime Office engine is incomplete')
    }
  }

  #partialPath(artifact: DownloadArtifact, target: WorkspaceRuntimeTarget): string {
    return join(this.#options.cacheRoot, '.downloads', `${artifact.payloadDigest}-${target}.part`)
  }

  #append(job: Job, text: string): void {
    job.output += text
    const limit = this.#options.maxOutputBytes ?? 64 * 1024
    if (Buffer.byteLength(job.output) <= limit) return
    const before = job.output.length
    job.output = job.output.slice(-limit)
    job.outputBase += before - job.output.length
  }

  #assertManifest(manifest: WorkspaceRuntimeManifest): void {
    const now = Date.now()
    if (manifest.desktopVersion !== this.#options.desktopVersion) throw new Error('desktop: workspace-runtime manifest is for another Desktop version')
    if (Date.parse(manifest.issuedAt) > now + 10 * 60_000 || Date.parse(manifest.expiresAt) <= now) {
      throw new Error('desktop: workspace-runtime manifest is expired or not yet valid')
    }
  }

  #assertCapability(capability: string): asserts capability is WorkspaceRuntimeCapability {
    if (!WORKSPACE_RUNTIME_CAPABILITIES.includes(capability as WorkspaceRuntimeCapability)) {
      throw new TypeError('desktop: unknown workspace-runtime capability')
    }
  }

  #requireJob(jobId: string): Job {
    if (typeof jobId !== 'string' || !/^[0-9a-f-]{36}$/u.test(jobId)) throw new TypeError('desktop: invalid workspace-runtime job id')
    const job = this.#jobs.get(jobId)
    if (job === undefined) throw new Error('desktop: workspace-runtime job was not found')
    return job
  }
}
