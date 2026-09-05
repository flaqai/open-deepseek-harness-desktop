/** Desktop-owned persistent diagnostic exercises with explicit crash-safe restoration. */

import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  lstat, mkdir, readFile, readdir, readlink, rename, rm, stat, unlink, writeFile,
} from 'node:fs/promises'
import {
  dirname, isAbsolute, join, relative, resolve, sep,
} from 'node:path'
import { parseDocument } from 'yaml'

/** Diagnostic scenarios accepted by the restricted Electron bridge. */
export type DiagnosticLabScenarioId =
  | 'host-shadow-compatible'
  | 'host-shadow-incompatible'
  | 'orphaned-bundle'
  | 'quarantine-removal-residue'
  | 'client-module-unavailable'
  | 'loader-package-name-mismatch'
  | 'loader-dependency-unavailable'
  | 'settings-invalid'
  | 'module-resolution-missing'
  | 'patch-invalid'
  | 'loader-duplicate'
  | 'loader-lifecycle-failure'
  | 'build-script-blocked'
  | 'interrupted-repair'
  | 'startup-operation-timeout'

/** Data environment used by one diagnostic exercise. */
type DiagnosticLabTarget = 'isolated' | 'active-profile'

/** One reviewed exercise shown by the Diagnostics Lab UI. */
export interface DiagnosticLabScenario {
  readonly id: DiagnosticLabScenarioId
  readonly title: string
  readonly description: string
  readonly expectedCode: string
  readonly targets: readonly DiagnosticLabTarget[]
}

/** Stable phases used by the progress timeline. */
export type DiagnosticLabStep = 'baseline' | 'inject' | 'detect' | 'repair' | 'verify' | 'retain'

/** Result of one scenario injection. */
export interface DiagnosticLabScenarioResult {
  readonly scenarioId: DiagnosticLabScenarioId
  readonly phase: 'passed' | 'failed' | 'cancelled'
  readonly expectedCode: string
  readonly actualCode?: string
  readonly repaired: boolean
  readonly retained: boolean
  readonly disposition?: 'repaired' | 'quarantined' | 'retained'
  readonly durationMs: number
  readonly diagnostic?: string
}

/** Recovery state retained across an interrupted desktop process. */
type DiagnosticLabRecoveryState = 'clean' | 'pending' | 'retained' | 'recovering' | 'failed'

/** Renderer-safe state for one lab run. */
export interface DiagnosticLabRunSnapshot {
  readonly schema: 2
  readonly runId: string
  readonly target: DiagnosticLabTarget
  readonly scenarioIds: readonly DiagnosticLabScenarioId[]
  readonly phase: 'queued' | 'running' | 'active' | 'restoring' | 'restored' | 'failed' | 'cancelled'
  readonly currentScenarioId?: DiagnosticLabScenarioId
  readonly currentStep?: DiagnosticLabStep
  readonly completedSteps: number
  readonly totalSteps: number
  readonly recovery: DiagnosticLabRecoveryState
  readonly startedAt: string
  readonly finishedAt?: string
  readonly results: readonly DiagnosticLabScenarioResult[]
  readonly diagnostic?: string
}

/** Request accepted by {@link DiagnosticLabManager.start}. */
export interface DiagnosticLabStartRequest {
  readonly scenarioIds: readonly DiagnosticLabScenarioId[]
  readonly target: DiagnosticLabTarget
}

interface DiagnosticLabJournal {
  readonly schema: 2
  readonly runId: string
  readonly target: DiagnosticLabTarget
  readonly activeDshHome: string
  readonly backupRoot?: string
  readonly files: readonly JournalFile[]
  readonly state: 'injecting' | 'active' | 'restoring' | 'clean'
}

interface LegacyDiagnosticLabJournal extends Omit<DiagnosticLabJournal, 'schema' | 'state'> {
  readonly schema: 1
  readonly state: 'running' | 'restoring' | 'clean'
}

interface JournalFile {
  readonly relativePath: string
  readonly existed: boolean
  readonly sha256?: string
}

interface ScenarioFixture {
  readonly code: string
  readonly file: string
  readonly content: string
  readonly checksum: string
  readonly repairedContent?: string
}

/** Result returned by the production Profile doctor subprocess. */
export interface DiagnosticLabDoctorResult {
  readonly status: string
  readonly issueCodes: readonly string[]
  readonly output: string
}

/** Host callbacks needed to pause an active Profile during an advanced run. */
export interface DiagnosticLabManagerOptions {
  readonly root: string
  readonly activeDshHome: string
  readonly logDirectory: string
  suspendHarness(): Promise<void>
  resumeHarness(): void
  installProfile(home: string, force: boolean): Promise<void>
  /** Install one closed, integrity-checked diagnostic resource through the product CLI. */
  installDiagnosticPlugin(
    home: string,
    packageName:
      | 'dsh-font'
      | '@dsh-diagnostic-lab/scoped-loader-mismatch'
      | '@dsh-diagnostic-lab/loader-dependency-unavailable',
  ): Promise<void>
  runDoctor(home: string, repair: boolean): Promise<DiagnosticLabDoctorResult>
  /** Run the desktop-owned fake CLI that proves timeout cancellation and rollback. */
  runStartupTimeoutExercise?(): Promise<{
    readonly actualCode: 'runtime.profile-check-timeout'
    readonly cancelled: boolean
    readonly rolledBack: boolean
    readonly continued: boolean
  }>
  onSnapshot(snapshot: DiagnosticLabRunSnapshot): void
  readonly now?: () => Date
  /** Test-only escape hatch; production always stages real Doctor fixtures. */
  readonly productionDoctorFixtures?: boolean
  /** Test override for the real browser-recovery observation window. */
  readonly clientRecoveryTimeoutMs?: number
}

const SCENARIOS: readonly DiagnosticLabScenario[] = [
  { id: 'host-shadow-compatible', title: 'Compatible Host shadow copy', description: 'Detects a second physical Host package that can converge to the bundled runtime.', expectedCode: 'profile.host-dependency-conflict', targets: ['isolated', 'active-profile'] },
  { id: 'host-shadow-incompatible', title: 'Incompatible Host dependency', description: 'Traces an incompatible dsh-tools edge and verifies quarantine.', expectedCode: 'profile.host-dependency-conflict', targets: ['isolated', 'active-profile'] },
  { id: 'orphaned-bundle', title: 'Orphaned Loader bundle', description: 'Finds a bundle retained after its manageable dependency disappeared.', expectedCode: 'profile.orphaned-bundle', targets: ['isolated', 'active-profile'] },
  { id: 'quarantine-removal-residue', title: 'Incomplete quarantine removal', description: 'Recreates a legacy uninstall that removed the plugin and quarantine record but left derived Profile state, then verifies bounded cleanup.', expectedCode: 'profile.quarantine-removal-residue', targets: ['isolated', 'active-profile'] },
  { id: 'loader-package-name-mismatch', title: 'Scoped Loader package-name mismatch', description: 'Installs a safe scoped package whose Bundle Patch names a missing unscoped module, then verifies immediate attribution and quarantine.', expectedCode: 'profile.module-resolution', targets: ['isolated', 'active-profile'] },
  { id: 'loader-dependency-unavailable', title: 'Loader dependency unavailable', description: 'Installs a resolvable aggregate Loader whose published entry imports a missing internal Host dependency, then verifies root attribution and quarantine.', expectedCode: 'loader.dependency-unavailable', targets: ['isolated', 'active-profile'] },
  { id: 'settings-invalid', title: 'Invalid settings document', description: 'Writes a duplicate-key settings.yaml and verifies that diagnostic safe mode skips it without modifying the original document.', expectedCode: 'config.settings-invalid', targets: ['isolated', 'active-profile'] },
  { id: 'client-module-unavailable', title: 'Packaged dsh-font client incompatibility', description: 'Installs the packaged dsh-font 1.1.0 fixture and verifies that the real browser boot path quarantines it without blocking the main UI.', expectedCode: 'profile.module-resolution', targets: ['active-profile'] },
  { id: 'module-resolution-missing', title: 'Missing plugin module', description: 'Attributes a missing module directory to the owning plugin.', expectedCode: 'profile.module-resolution', targets: ['isolated'] },
  { id: 'patch-invalid', title: 'Invalid Profile patch', description: 'Locates malformed Profile YAML without touching the user patch.', expectedCode: 'profile.patch-invalid', targets: ['isolated'] },
  { id: 'loader-duplicate', title: 'Duplicate Loader entry', description: 'Detects duplicate Loader registration before activation.', expectedCode: 'loader.duplicate-entry', targets: ['isolated'] },
  { id: 'loader-lifecycle-failure', title: 'Loader lifecycle failure', description: 'Exercises mount failure attribution and rollback reporting.', expectedCode: 'loader.lifecycle-failed', targets: ['isolated'] },
  { id: 'build-script-blocked', title: 'Blocked build script', description: 'Uses a reviewed local marker script to verify exact allowBuilds approval.', expectedCode: 'pnpm.build-script-blocked', targets: ['isolated'] },
  { id: 'interrupted-repair', title: 'Interrupted repair recovery', description: 'Leaves a recovery journal at a controlled boundary and resumes cleanup.', expectedCode: 'runtime.interrupted-repair', targets: ['isolated'] },
  { id: 'startup-operation-timeout', title: 'Bounded startup operation timeout', description: 'Simulates a one-shot startup command timing out, then verifies cancellation, rollback evidence, and continued startup.', expectedCode: 'runtime.profile-check-timeout', targets: ['isolated'] },
]

const SCENARIO_BY_ID = new Map(SCENARIOS.map(scenario => [scenario.id, scenario]))
const PRODUCTION_REPAIR_STATUS = {
  'host-shadow-compatible': 'repaired',
  'host-shadow-incompatible': 'quarantined',
  'orphaned-bundle': 'quarantined',
  'quarantine-removal-residue': 'repaired',
} as const
const PRODUCTION_DOCTOR_SCENARIOS = Object.keys(PRODUCTION_REPAIR_STATUS) as Array<
  keyof typeof PRODUCTION_REPAIR_STATUS
>
const DIAGNOSTIC_PACKAGE_SCOPE = '@dsh-diagnostic-lab'
const MANAGED_PROFILE_FILES = [
  'profiles/web/package.json',
  'profiles/web/pnpm-workspace.yaml',
  'profiles/web/pnpm-lock.yaml',
  'profiles/web/cordis.patch.yml',
  'settings.yaml',
  'quarantine/profile-plugins.json',
  'profile-health/web.json',
  'profile-health/web.diagnostics.json',
  'profile-health/safe-mode-settings.yaml',
] as const
const MAX_DIAGNOSTIC_BYTES = 8 * 1024

const FIXTURES: Record<DiagnosticLabScenarioId, ScenarioFixture> = {
  'host-shadow-compatible': { code: 'profile.host-dependency-conflict', file: 'node_modules/fixture/node_modules/@deepseek-ai/cordis/package.json', content: '{"name":"@deepseek-ai/cordis","version":"3.0.0","diagnostic":"compatible-shadow"}\n', checksum: '3296df1dc0d4d57df1e453f70f757c469010409d3a81da5b229238116edcdf8f', repairedContent: '{"linkedTo":"$HOST"}\n' },
  'host-shadow-incompatible': { code: 'profile.host-dependency-conflict', file: 'node_modules/fixture/node_modules/@deepseek-ai/dsh-tools/package.json', content: '{"name":"@deepseek-ai/dsh-tools","version":"0.0.0-diagnostic","diagnostic":"incompatible-shadow"}\n', checksum: '03d594435d63e8791fa1ca3732ec08e2206a170c148ade9374fb96e3aacd36ee', repairedContent: '{"quarantined":true}\n' },
  'orphaned-bundle': { code: 'profile.orphaned-bundle', file: 'profile/orphaned-bundle.json', content: '{"bundle":"@hecoococ/dsh-lab-orphan","dependency":false}\n', checksum: 'd87932d81021cb20134cfed70aa15bff6ac11cea20304e17dd54382fa91d5e26', repairedContent: '{"bundles":[]}\n' },
  'quarantine-removal-residue': { code: 'profile.quarantine-removal-residue', file: 'profile/quarantine-removal-residue.json', content: '{"package":"@dsh-diagnostic-lab/quarantine-removal-residue","state":"legacy-uninstall-residue"}\n', checksum: 'fabaf15aaf1b81b1a5b018761927a15a60f823153692439c2b23c5256fe5921b', repairedContent: '{"removed":true}\n' },
  'loader-package-name-mismatch': { code: 'profile.module-resolution', file: 'profile/scoped-loader-mismatch.json', content: '{"package":"@dsh-diagnostic-lab/scoped-loader-mismatch","version":"1.0.0"}\n', checksum: '891275ddb0053315f3d9ec6f90aa0d7cbee3a5720364d3a8fd10122ff3104967' },
  'loader-dependency-unavailable': { code: 'loader.dependency-unavailable', file: 'profile/loader-dependency-unavailable.json', content: '{"package":"@dsh-diagnostic-lab/loader-dependency-unavailable","version":"1.0.0"}\n', checksum: 'b9251b2ec6e6b2d834acb5b6d4c13b55a9ef6e8a53890012072ccdaf19cea6f0' },
  'settings-invalid': { code: 'config.settings-invalid', file: 'profile/settings-invalid.json', content: 'diagnostic-lab-duplicate: one\ndiagnostic-lab-duplicate: two\n', checksum: 'af6043d7e12cbf592177d0ca81872a8a0ef09e4cb1d15589e368b906076208a2' },
  'client-module-unavailable': { code: 'profile.module-resolution', file: 'profile/dsh-font.json', content: '{"package":"dsh-font","version":"1.1.0","source":"packaged-diagnostic"}\n', checksum: 'ff3cf467522316802d16c7ad88863be9becc9789b2e61f94b121c44e786ffec7' },
  'module-resolution-missing': { code: 'profile.module-resolution', file: 'profile/missing-module.json', content: '{"module":"@hecoococ/dsh-lab-missing","exists":false}\n', checksum: '089ed0ccd5e318ad94cae5ea48017bc946676bfa6f4a66e041740369fbc2f221', repairedContent: '{"disabled":true}\n' },
  'patch-invalid': { code: 'profile.patch-invalid', file: 'profile/cordis.patch.yml', content: '- id: diagnostic-lab\n  config: [unterminated\n', checksum: '69ba3a95f37f79f029ade77436be37cb78c1b8d03c57d9133ae37eab3ea61dd5', repairedContent: '[]\n' },
  'loader-duplicate': { code: 'loader.duplicate-entry', file: 'profile/loader.json', content: '{"entries":["diagnostic-lab","diagnostic-lab"]}\n', checksum: '5684e3a05c702d0823d15347ac0a77a7294ca80ef2486e8b5b4f61e80190b26f', repairedContent: '{"entries":["diagnostic-lab"]}\n' },
  'loader-lifecycle-failure': { code: 'loader.lifecycle-failed', file: 'profile/lifecycle.json', content: '{"entry":"diagnostic-lab","mount":"throw","rollback":"verified"}\n', checksum: 'ab378d7d5445c8506ac472dbec274b18a06259813dd8cbe70a98cd4d62696238', repairedContent: '{"disabled":true}\n' },
  'build-script-blocked': { code: 'pnpm.build-script-blocked', file: 'profile/build.json', content: '{"package":"@hecoococ/dsh-lab-build","allowed":false,"script":"write-marker"}\n', checksum: 'ed9d0c04fd3ce37918df14818a6c2d39d884a1f97ed735bfe76f22c1080234d5', repairedContent: '{"package":"@hecoococ/dsh-lab-build","allowed":true,"marker":true}\n' },
  'interrupted-repair': { code: 'runtime.interrupted-repair', file: 'profile/interrupted.json', content: '{"repair":"interrupted","journal":true}\n', checksum: '45864a432cef75a4af007e732ec9c42166174f6c3a20b1ba035d5c2f708cca13', repairedContent: '{"repair":"recovered"}\n' },
  'startup-operation-timeout': { code: 'runtime.profile-check-timeout', file: 'profile/startup-timeout.json', content: '{"operation":"profile-check","state":"timeout","rolledBack":true}\n', checksum: 'e5cd8557899751ba49b1fba0e27266fb46303f05f3ca22f2d71450f3c488c0ee', repairedContent: '{"operation":"profile-check","state":"cancelled","rolledBack":true}\n' },
}

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function sanitize(value: string, home: string): string {
  const replaced = value
    .replaceAll(home, '$DSH_HOME')
    .replace(/(authorization|api[_-]?key|token|password)(\s*[:=]\s*)\S+/giu, '$1$2[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gu, '[REDACTED]')
    .replace(/C:\\Users\\[^\\\s]+/giu, '%USERPROFILE%')
    .replace(/\/Users\/[^/\s]+/gu, '$HOME')
  const encoded = Buffer.from(replaced)
  return encoded.length <= MAX_DIAGNOSTIC_BYTES
    ? replaced
    : encoded.subarray(encoded.length - MAX_DIAGNOSTIC_BYTES).toString('utf8')
}

function describeUnknown(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  if (value === undefined) return 'Unknown diagnostic lab failure'
  try {
    const serialized: unknown = JSON.stringify(value)
    return typeof serialized === 'string' ? serialized : 'Unknown diagnostic lab failure'
  } catch {
    return 'Unknown diagnostic lab failure'
  }
}

function unknownArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value as readonly unknown[] : []
}

function isTarget(value: unknown): value is DiagnosticLabTarget {
  return value === 'isolated' || value === 'active-profile'
}

function assertInside(root: string, path: string): void {
  const child = relative(resolve(root), resolve(path))
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error('desktop: diagnostic lab path escapes its managed root')
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, content, { flag: 'wx', mode: 0o600 })
  await rename(temporary, path)
}

async function removeWithoutFollowing(path: string): Promise<void> {
  let metadata
  try {
    metadata = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (metadata.isSymbolicLink()) {
    await unlink(path)
    return
  }
  await rm(path, { recursive: true, force: true })
}

async function treeLinksToRun(root: string, runId: string): Promise<boolean> {
  const runMarker = runId.slice(0, 16)
  const pending = [root]
  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const target = await readlink(path)
        if (target.includes('diagnostic-fixtures') && target.includes(runMarker)) return true
      } else if (entry.isDirectory()) {
        pending.push(path)
      }
    }
  }
  return false
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function cloneSnapshot(snapshot: DiagnosticLabRunSnapshot): DiagnosticLabRunSnapshot {
  return structuredClone(snapshot)
}

function textReport(snapshot: DiagnosticLabRunSnapshot): string {
  const lines = [
    'DeepSeek Harness Desktop Diagnostics Lab',
    `Run: ${snapshot.runId}`,
    `Target: ${snapshot.target}`,
    `Result: ${snapshot.phase}`,
    `Recovery: ${snapshot.recovery}`,
    '',
  ]
  for (const result of snapshot.results) {
    lines.push(
      `[${result.phase.toUpperCase()}] ${result.scenarioId}`,
      `  expected: ${result.expectedCode}`,
      `  actual: ${result.actualCode ?? 'none'}`,
      `  repaired: ${String(result.repaired)}`,
      `  retained: ${String(result.retained)}`,
      `  disposition: ${result.disposition ?? 'none'}`,
      `  duration: ${result.durationMs} ms`,
    )
    if (result.diagnostic !== undefined) lines.push(`  diagnostic: ${result.diagnostic}`)
  }
  if (snapshot.diagnostic !== undefined) lines.push('', `Run diagnostic: ${snapshot.diagnostic}`)
  return `${lines.join('\n')}\n`
}

/** Serial diagnostic exercise owner. */
export class DiagnosticLabManager {
  readonly #options: DiagnosticLabManagerOptions
  #active: DiagnosticLabRunSnapshot | undefined
  #cancelled = new Set<string>()

  /** @param options - Private storage, active Profile, lifecycle, and publication callbacks. */
  constructor(options: DiagnosticLabManagerOptions) {
    this.#options = options
  }

  /** @returns The fixed reviewed scenario catalog. */
  catalog(): readonly DiagnosticLabScenario[] {
    return SCENARIOS
  }

  /** @returns The latest desktop-owned run so a reloaded Harness UI can reconnect. */
  current(): DiagnosticLabRunSnapshot | undefined {
    return this.#active === undefined ? undefined : cloneSnapshot(this.#active)
  }

  /** Recover journals left by an interrupted desktop process before Harness starts. */
  async recoverPending(): Promise<void> {
    const runsRoot = join(this.#options.root, 'runs')
    if (!existsSync(runsRoot)) return
    const retained: DiagnosticLabRunSnapshot[] = []
    for (const entry of await readdir(runsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const runRoot = join(runsRoot, entry.name)
      const journal = await this.#readJournal(runRoot)
      if (journal?.state === 'clean' && !await this.#hasRunResidue(journal)) continue
      if (journal?.schema === 2 && journal.state === 'active') {
        retained.push(await this.#readReport(runRoot))
        continue
      }
      if (journal !== undefined) {
        try {
          await this.#restoreRun(runRoot, { ...journal, state: 'restoring' })
        } catch (error) {
          const failed = await this.#recoveryFailureSnapshot(runRoot, journal, error)
          this.#active = failed
          this.#publish(failed)
          return
        }
      }
    }
    if (retained.length > 1) {
      throw new Error('desktop: multiple retained diagnostic lab runs require manual recovery')
    }
    if (retained[0] !== undefined) {
      this.#active = retained[0]
    }
  }

  /** Start one validated serial run and return its initial state. */
  start(request: DiagnosticLabStartRequest): DiagnosticLabRunSnapshot {
    if (this.#active !== undefined && (
      ['queued', 'running', 'active', 'restoring'].includes(this.#active.phase)
      || this.#active.recovery === 'failed'
    )) {
      throw new Error('desktop: another diagnostic lab run is active')
    }
    if (!isTarget(request.target)) {
      throw new TypeError('desktop: invalid diagnostic lab request')
    }
    const restartRank = (id: DiagnosticLabScenarioId): number => (
      id === 'settings-invalid' ? 2 : id === 'client-module-unavailable' ? 1 : 0
    )
    const scenarioIds = [...new Set(request.scenarioIds)].sort((left, right) => (
      restartRank(left) - restartRank(right)
    ))
    if (scenarioIds.length === 0 || scenarioIds.some(id => !SCENARIO_BY_ID.has(id))) {
      throw new TypeError('desktop: invalid diagnostic lab scenario selection')
    }
    for (const id of scenarioIds) {
      const scenario = SCENARIO_BY_ID.get(id)
      if (scenario === undefined || !scenario.targets.includes(request.target)) {
        throw new TypeError(`desktop: scenario ${id} is unavailable for ${request.target}`)
      }
    }
    const snapshot: DiagnosticLabRunSnapshot = {
      schema: 2,
      runId: randomUUID(),
      target: request.target,
      scenarioIds,
      phase: 'queued',
      completedSteps: 0,
      totalSteps: scenarioIds.length * 6,
      recovery: request.target === 'active-profile' ? 'pending' : 'clean',
      startedAt: (this.#options.now ?? (() => new Date()))().toISOString(),
      results: [],
    }
    this.#active = snapshot
    this.#publish(snapshot)
    void this.#run(snapshot).catch(async (error: unknown) => {
      const current = this.#active
      if (current?.runId !== snapshot.runId) return
      const failed: DiagnosticLabRunSnapshot = {
        ...current,
        phase: 'failed',
        recovery: current.recovery === 'pending' ? 'failed' : current.recovery,
        finishedAt: (this.#options.now ?? (() => new Date()))().toISOString(),
        diagnostic: sanitize(describeUnknown(error), this.#options.activeDshHome),
      }
      try {
        await this.#writeReport(join(this.#options.root, 'runs', snapshot.runId), failed)
      } catch (reportError) {
        console.error('desktop: could not persist failed diagnostic lab report', reportError)
      }
      this.#replace(failed)
    })
    return cloneSnapshot(snapshot)
  }

  /** @returns Current state for the requested run. */
  get(runId: string): DiagnosticLabRunSnapshot {
    if (this.#active?.runId !== runId) throw new Error(`desktop: unknown diagnostic lab run ${runId}`)
    return cloneSnapshot(this.#active)
  }

  /** Request cancellation at the next safe scenario boundary. */
  cancel(runId: string): DiagnosticLabRunSnapshot {
    const snapshot = this.get(runId)
    if (snapshot.phase === 'queued' || snapshot.phase === 'running') this.#cancelled.add(runId)
    return snapshot
  }

  /** Restore every retained file and dependency touched by one completed exercise. */
  async restoreAll(runId: string): Promise<DiagnosticLabRunSnapshot> {
    const snapshot = this.get(runId)
    if (snapshot.phase === 'restored') return snapshot
    if (snapshot.phase !== 'active' && snapshot.recovery !== 'failed') {
      throw new Error('desktop: diagnostic lab run is not awaiting restoration')
    }
    const runRoot = join(this.#options.root, 'runs', runId)
    const journal = await this.#readJournal(runRoot)
    if (journal?.schema !== 2 || !['active', 'restoring', 'clean'].includes(journal.state)) {
      throw new Error('desktop: retained diagnostic recovery journal is unavailable')
    }
    this.#replace({ ...snapshot, phase: 'restoring', recovery: 'recovering' })
    let suspended = false
    try {
      if (snapshot.target === 'active-profile') {
        await this.#options.suspendHarness()
        suspended = true
      }
      await this.#writeJournal(runRoot, { ...journal, state: 'restoring' })
      await this.#restoreRun(runRoot, { ...journal, state: 'restoring' })
      const current = this.#requireActive(runId)
      const {
        currentScenarioId: _currentScenarioId,
        currentStep: _currentStep,
        ...restorable
      } = current
      const restored: DiagnosticLabRunSnapshot = {
        ...restorable,
        phase: 'restored',
        recovery: 'clean',
        finishedAt: (this.#options.now ?? (() => new Date()))().toISOString(),
      }
      await this.#writeReport(runRoot, restored)
      this.#replace(restored)
      if (suspended) {
        this.#options.resumeHarness()
        suspended = false
      }
      return cloneSnapshot(restored)
    } catch (error) {
      const failed: DiagnosticLabRunSnapshot = {
        ...this.#requireActive(runId),
        phase: 'active',
        recovery: 'failed',
        diagnostic: sanitize(describeUnknown(error), this.#options.activeDshHome),
      }
      await this.#writeReport(runRoot, failed)
      this.#replace(failed)
      throw error
    }
  }

  /** @returns A redacted JSON report for browser download. */
  exportReport(runId: string): string {
    return `${JSON.stringify(this.get(runId), undefined, 2)}\n`
  }

  async #run(initial: DiagnosticLabRunSnapshot): Promise<void> {
    const runRoot = join(this.#options.root, 'runs', initial.runId)
    assertInside(this.#options.root, runRoot)
    await mkdir(join(runRoot, 'runtime'), { recursive: true, mode: 0o700 })
    let journal: DiagnosticLabJournal = {
      schema: 2,
      runId: initial.runId,
      target: initial.target,
      activeDshHome: this.#options.activeDshHome,
      files: [],
      state: 'injecting',
    }
    let suspended = false
    let fatal: unknown
    try {
      if (initial.target === 'active-profile') {
        await this.#options.suspendHarness()
        suspended = true
        journal = await this.#backupActiveProfile(runRoot, journal)
      }
      await this.#writeJournal(runRoot, journal)
      this.#replace({ ...initial, phase: 'running' })
      for (const scenarioId of initial.scenarioIds) {
        if (this.#cancelled.has(initial.runId)) break
        if (scenarioId === 'client-module-unavailable') {
          if (!suspended) {
            await this.#options.suspendHarness()
            suspended = true
          }
          await this.#runClientModuleScenario(() => {
            this.#options.resumeHarness()
            suspended = false
          })
        } else if (scenarioId === 'settings-invalid') {
          if (initial.target === 'active-profile' && !suspended) {
            await this.#options.suspendHarness()
            suspended = true
          }
          await this.#runSettingsInvalidScenario(runRoot, () => {
            this.#options.resumeHarness()
            suspended = false
          })
        } else if (scenarioId === 'loader-package-name-mismatch'
          || scenarioId === 'loader-dependency-unavailable') {
          await this.#runLoaderPluginScenario(runRoot, scenarioId)
        } else if (scenarioId === 'startup-operation-timeout') {
          await this.#runStartupTimeoutScenario(runRoot)
        } else {
          await this.#runScenario(runRoot, scenarioId)
        }
      }
    } catch (error) {
      fatal = error
    }
    const current = this.#requireActive(initial.runId)
    const cancelled = this.#cancelled.delete(initial.runId)
    const finishedAt = (this.#options.now ?? (() => new Date()))().toISOString()
    if (fatal === undefined && !cancelled && current.results.every(result => result.phase === 'passed')) {
      const retainedSnapshot: DiagnosticLabRunSnapshot = {
        ...current,
        phase: 'active',
        recovery: 'retained',
        finishedAt,
      }
      try {
        await this.#writeReport(runRoot, retainedSnapshot)
        await this.#writeJournal(runRoot, { ...journal, state: 'active' })
        this.#replace(retainedSnapshot)
        if (suspended) {
          this.#options.resumeHarness()
          suspended = false
        }
        return
      } catch (error) {
        fatal = error
      }
    }
    let recovery: DiagnosticLabRecoveryState = 'recovering'
    let recoveryFailure: unknown
    try {
      if (initial.target === 'active-profile' && !suspended) {
        await this.#options.suspendHarness()
        suspended = true
      }
      await this.#writeJournal(runRoot, { ...journal, state: 'restoring' })
      await this.#restoreRun(runRoot, { ...journal, state: 'restoring' })
      recovery = 'clean'
    } catch (error) {
      recovery = 'failed'
      recoveryFailure = error
    }
    if (suspended && recovery === 'clean') {
      try {
        this.#options.resumeHarness()
        suspended = false
      } catch (error) {
        recovery = 'failed'
        recoveryFailure ??= error
      }
    }
    const diagnostic = [fatal, recoveryFailure]
      .filter(value => value !== undefined)
      .map(describeUnknown)
      .join('\n')
    const terminalSnapshot: DiagnosticLabRunSnapshot = {
      ...current,
      phase: cancelled ? 'cancelled' : 'failed',
      recovery,
      finishedAt,
      ...(diagnostic.length === 0 ? {} : { diagnostic: sanitize(diagnostic, this.#options.activeDshHome) }),
    }
    await this.#writeReport(runRoot, terminalSnapshot)
    this.#replace(terminalSnapshot)
  }

  /** Exercise the bounded one-shot supervisor without touching the active Profile. */
  async #runStartupTimeoutScenario(runRoot: string): Promise<void> {
    const scenarioId = 'startup-operation-timeout' as const
    const fixture = FIXTURES[scenarioId]
    const active = this.#requireActive()
    const scenarioRoot = join(runRoot, 'runtime', 'scenarios', scenarioId)
    assertInside(join(runRoot, 'runtime'), scenarioRoot)
    const fixturePath = join(scenarioRoot, fixture.file)
    const started = Date.now()
    let actualCode: string | undefined
    try {
      await this.#step(scenarioId, 'baseline')
      if (existsSync(scenarioRoot)) throw new Error('diagnostic scenario baseline contains stale files')
      await this.#step(scenarioId, 'inject')
      await atomicWrite(fixturePath, fixture.content)
      if (sha256(await readFile(fixturePath)) !== fixture.checksum) {
        throw new Error('diagnostic fixture integrity check failed')
      }
      await this.#step(scenarioId, 'detect')
      const exercise = await this.#options.runStartupTimeoutExercise?.()
      if (exercise === undefined) throw new Error('desktop startup timeout exercise is unavailable')
      actualCode = exercise.actualCode
      if (actualCode !== fixture.code || !exercise.cancelled) {
        throw new Error('fake startup CLI was not cancelled with the expected timeout incident')
      }
      await this.#step(scenarioId, 'repair')
      if (!exercise.rolledBack) throw new Error('fake startup CLI mutation was not rolled back')
      if (fixture.repairedContent !== undefined) await atomicWrite(fixturePath, fixture.repairedContent)
      await this.#step(scenarioId, 'verify')
      if (!exercise.continued || await this.#detectScenario(fixturePath, fixture) === fixture.code) {
        throw new Error('startup did not continue after the bounded timeout rollback')
      }
      await this.#step(scenarioId, 'retain')
      this.#appendResult({
        scenarioId,
        phase: 'passed',
        expectedCode: fixture.code,
        actualCode,
        repaired: true,
        retained: true,
        disposition: 'repaired',
        durationMs: Date.now() - started,
      })
    } catch (error) {
      this.#appendResult({
        scenarioId,
        phase: this.#cancelled.has(active.runId) ? 'cancelled' : 'failed',
        expectedCode: fixture.code,
        ...(actualCode === undefined ? {} : { actualCode }),
        repaired: false,
        retained: existsSync(scenarioRoot),
        durationMs: Date.now() - started,
        diagnostic: sanitize(describeUnknown(error), this.#options.activeDshHome),
      })
      throw error
    }
  }

  /** Install a Loader fixture through the normal CLI and verify immediate quarantine. */
  async #runLoaderPluginScenario(
    runRoot: string,
    scenarioId: 'loader-package-name-mismatch' | 'loader-dependency-unavailable',
  ): Promise<void> {
    const fixture = FIXTURES[scenarioId]
    const active = this.#requireActive()
    const home = active.target === 'active-profile'
      ? this.#options.activeDshHome
      : join(runRoot, 'runtime', 'doctor-homes', scenarioId)
    const scenarioRoot = active.target === 'active-profile'
      ? join(home, 'profiles', 'web', '.diagnostic-lab', active.runId, scenarioId)
      : join(runRoot, 'runtime', 'scenarios', scenarioId)
    const boundary = active.target === 'active-profile'
      ? join(home, 'profiles', 'web', '.diagnostic-lab')
      : join(runRoot, 'runtime')
    assertInside(boundary, scenarioRoot)
    const fixturePath = join(scenarioRoot, fixture.file)
    const packageName = scenarioId === 'loader-package-name-mismatch'
      ? '@dsh-diagnostic-lab/scoped-loader-mismatch' as const
      : '@dsh-diagnostic-lab/loader-dependency-unavailable' as const
    const quarantineReason = scenarioId === 'loader-package-name-mismatch'
      ? 'loader-module-unresolvable'
      : 'loader-dependency-unavailable'
    const started = Date.now()
    let actualCode: string | undefined
    try {
      await this.#step(scenarioId, 'baseline')
      if (existsSync(scenarioRoot)) throw new Error('diagnostic scenario baseline contains stale files')
      await this.#step(scenarioId, 'inject')
      await atomicWrite(fixturePath, fixture.content)
      if (sha256(await readFile(fixturePath)) !== fixture.checksum) {
        throw new Error('diagnostic fixture integrity check failed')
      }
      await this.#options.installDiagnosticPlugin(home, packageName)
      await this.#step(scenarioId, 'detect')
      if (!await this.#hasQuarantine(home, packageName, quarantineReason, fixture.code)) {
        throw new Error(`${scenarioId} was not quarantined by post-install preflight`)
      }
      actualCode = fixture.code
      await this.#step(scenarioId, 'repair')
      await this.#step(scenarioId, 'verify')
      const doctor = await this.#options.runDoctor(home, false)
      if (!['healthy', 'repaired', 'quarantined'].includes(doctor.status)) {
        throw new Error(`Profile remained unhealthy after Loader quarantine: ${doctor.status}`)
      }
      await this.#step(scenarioId, 'retain')
      this.#appendResult({
        scenarioId,
        phase: 'passed',
        expectedCode: fixture.code,
        actualCode,
        repaired: true,
        retained: true,
        disposition: 'quarantined',
        durationMs: Date.now() - started,
      })
    } catch (error) {
      this.#appendResult({
        scenarioId,
        phase: this.#cancelled.has(active.runId) ? 'cancelled' : 'failed',
        expectedCode: fixture.code,
        ...(actualCode === undefined ? {} : { actualCode }),
        repaired: false,
        retained: existsSync(scenarioRoot),
        durationMs: Date.now() - started,
        diagnostic: sanitize(describeUnknown(error), this.#options.activeDshHome),
      })
      throw error
    }
  }

  /** Exercise duplicate-key settings detection and the isolated safe-mode document. */
  async #runSettingsInvalidScenario(runRoot: string, resumeHarness: () => void): Promise<void> {
    const scenarioId = 'settings-invalid' as const
    const fixture = FIXTURES[scenarioId]
    const active = this.#requireActive()
    const home = active.target === 'active-profile'
      ? this.#options.activeDshHome
      : join(runRoot, 'runtime', 'doctor-homes', scenarioId)
    const scenarioRoot = active.target === 'active-profile'
      ? join(home, 'profiles', 'web', '.diagnostic-lab', active.runId, scenarioId)
      : join(runRoot, 'runtime', 'scenarios', scenarioId)
    const boundary = active.target === 'active-profile'
      ? join(home, 'profiles', 'web', '.diagnostic-lab')
      : join(runRoot, 'runtime')
    assertInside(boundary, scenarioRoot)
    const fixturePath = join(scenarioRoot, 'profile', 'settings-invalid.json')
    const settingsPath = join(home, 'settings.yaml')
    const safeSettingsPath = join(home, 'profile-health', 'safe-mode-settings.yaml')
    const started = Date.now()
    let actualCode: string | undefined
    try {
      await this.#step(scenarioId, 'baseline')
      if (existsSync(scenarioRoot)) throw new Error('diagnostic scenario baseline contains stale files')
      if (existsSync(settingsPath)) {
        const baseline = parseDocument(await readFile(settingsPath, 'utf8'))
        if (baseline.errors.length > 0) throw new Error('active settings document is already invalid')
      }

      await this.#step(scenarioId, 'inject')
      await atomicWrite(fixturePath, `${JSON.stringify({ scenario: scenarioId })}\n`)
      await atomicWrite(settingsPath, fixture.content)
      if (sha256(await readFile(settingsPath)) !== fixture.checksum) {
        throw new Error('diagnostic settings fixture integrity check failed')
      }

      await this.#step(scenarioId, 'detect')
      if (active.target === 'active-profile') {
        resumeHarness()
        await this.#waitForSettingsSafeMode(home)
        actualCode = fixture.code
      } else {
        const invalid = parseDocument(await readFile(settingsPath, 'utf8'))
        actualCode = invalid.errors.length > 0 ? fixture.code : undefined
        await atomicWrite(safeSettingsPath, '{}\n')
      }
      if (actualCode !== fixture.code) throw new Error(`expected ${fixture.code}, received ${actualCode}`)

      await this.#step(scenarioId, 'repair')
      await this.#step(scenarioId, 'verify')
      if (sha256(await readFile(settingsPath)) !== fixture.checksum) {
        throw new Error('safe mode modified the invalid user settings document')
      }
      const safe = parseDocument(await readFile(safeSettingsPath, 'utf8'))
      if (safe.errors.length > 0 || safe.toJS() === null || typeof safe.toJS() !== 'object') {
        throw new Error('diagnostic safe-mode settings document is not a valid map')
      }

      await this.#step(scenarioId, 'retain')
      this.#appendResult({
        scenarioId,
        phase: 'passed',
        expectedCode: fixture.code,
        actualCode,
        repaired: true,
        retained: true,
        disposition: 'retained',
        durationMs: Date.now() - started,
      })
    } catch (error) {
      this.#appendResult({
        scenarioId,
        phase: this.#cancelled.has(active.runId) ? 'cancelled' : 'failed',
        expectedCode: fixture.code,
        ...(actualCode === undefined ? {} : { actualCode }),
        repaired: false,
        retained: existsSync(scenarioRoot),
        durationMs: Date.now() - started,
        diagnostic: sanitize(describeUnknown(error), this.#options.activeDshHome),
      })
      throw error
    }
  }

  async #runScenario(runRoot: string, scenarioId: DiagnosticLabScenarioId): Promise<void> {
    const fixture = FIXTURES[scenarioId]
    const scenarioRoot = this.#active?.target === 'active-profile'
      ? join(this.#options.activeDshHome, 'profiles', 'web', '.diagnostic-lab', this.#active.runId, scenarioId)
      : join(runRoot, 'runtime', 'scenarios', scenarioId)
    const doctorHome = this.#active?.target === 'active-profile'
      ? this.#options.activeDshHome
      : join(runRoot, 'runtime', 'doctor-homes', scenarioId)
    const scenarioBoundary = this.#active?.target === 'active-profile'
      ? join(this.#options.activeDshHome, 'profiles', 'web', '.diagnostic-lab')
      : join(runRoot, 'runtime')
    assertInside(scenarioBoundary, scenarioRoot)
    const fixturePath = join(scenarioRoot, fixture.file)
    const started = Date.now()
    let actualCode: string | undefined
    try {
      await this.#step(scenarioId, 'baseline')
      if (existsSync(scenarioRoot)) throw new Error('diagnostic scenario baseline contains stale files')
      const isolated = this.#active?.target === 'isolated'
      const baseline = await this.#options.runDoctor(doctorHome, isolated)
      if (!['healthy', 'repaired', 'quarantined'].includes(baseline.status)) {
        throw new Error(`production Doctor baseline failed with status ${baseline.status}`)
      }
      await this.#step(scenarioId, 'inject')
      await atomicWrite(fixturePath, fixture.content)
      if (sha256(await readFile(fixturePath)) !== fixture.checksum) {
        throw new Error('diagnostic fixture integrity check failed')
      }
      const productionFixture = this.#options.productionDoctorFixtures !== false
        && [
          'host-shadow-compatible',
          'host-shadow-incompatible',
          'orphaned-bundle',
          'quarantine-removal-residue',
        ].includes(scenarioId)
      if (productionFixture) await this.#stageProductionDoctorFixture(doctorHome, scenarioId)
      await this.#step(scenarioId, 'detect')
      const inspected = await this.#options.runDoctor(doctorHome, false)
      actualCode = productionFixture
        ? inspected.issueCodes.find(code => code === fixture.code)
        : await this.#detectScenario(fixturePath, fixture)
      if (actualCode !== fixture.code) throw new Error(`expected ${fixture.code}, received ${actualCode}`)
      await this.#step(scenarioId, 'repair')
      const repaired = await this.#options.runDoctor(doctorHome, true)
      if (productionFixture) {
        const expectedStatus = PRODUCTION_REPAIR_STATUS[scenarioId as keyof typeof PRODUCTION_REPAIR_STATUS]
        if (repaired.status !== expectedStatus) {
          throw new Error(`production Doctor repair expected ${expectedStatus}, received ${repaired.status}`)
        }
      }
      if (fixture.repairedContent !== undefined) await atomicWrite(fixturePath, fixture.repairedContent)
      await this.#step(scenarioId, 'verify')
      const verified = await this.#options.runDoctor(doctorHome, false)
      const expectedDisposition = productionFixture
        ? PRODUCTION_REPAIR_STATUS[scenarioId as keyof typeof PRODUCTION_REPAIR_STATUS]
        : undefined
      if ((productionFixture && verified.issueCodes.includes(fixture.code))
        || (!productionFixture && await this.#detectScenario(fixturePath, fixture) === fixture.code)) {
        throw new Error(`diagnostic scenario ${scenarioId} remained unhealthy after repair`)
      }
      await this.#step(scenarioId, 'retain')
      this.#appendResult({
        scenarioId, phase: 'passed', expectedCode: fixture.code, actualCode,
        repaired: true, retained: true,
        disposition: expectedDisposition ?? 'retained',
        durationMs: Date.now() - started,
      })
    } catch (error) {
      this.#appendResult({
        scenarioId,
        phase: this.#cancelled.has(this.#requireActive().runId) ? 'cancelled' : 'failed',
        expectedCode: fixture.code, ...(actualCode === undefined ? {} : { actualCode }),
        repaired: false, retained: existsSync(scenarioRoot), durationMs: Date.now() - started,
        diagnostic: sanitize(error instanceof Error ? error.message : String(error), this.#options.activeDshHome),
      })
      throw error
    }
  }

  /** Exercise the actual client Loader failure and wait for browser-driven quarantine. */
  async #runClientModuleScenario(resumeHarness: () => void): Promise<void> {
    const scenarioId = 'client-module-unavailable' as const
    const fixture = FIXTURES[scenarioId]
    const active = this.#requireActive()
    if (active.target !== 'active-profile') throw new Error('dsh-font diagnostic requires the active Profile')
    const scenarioRoot = join(
      this.#options.activeDshHome,
      'profiles',
      'web',
      '.diagnostic-lab',
      active.runId,
      scenarioId,
    )
    assertInside(join(this.#options.activeDshHome, 'profiles', 'web', '.diagnostic-lab'), scenarioRoot)
    const fixturePath = join(scenarioRoot, fixture.file)
    const started = Date.now()
    let actualCode: string | undefined
    try {
      await this.#step(scenarioId, 'baseline')
      if (existsSync(scenarioRoot)) throw new Error('diagnostic scenario baseline contains stale files')
      const baseline = await this.#options.runDoctor(this.#options.activeDshHome, false)
      if (!['healthy', 'repaired', 'quarantined'].includes(baseline.status)) {
        throw new Error(`production Doctor baseline failed with status ${baseline.status}`)
      }

      await this.#step(scenarioId, 'inject')
      await atomicWrite(fixturePath, fixture.content)
      if (sha256(await readFile(fixturePath)) !== fixture.checksum) {
        throw new Error('diagnostic fixture integrity check failed')
      }
      await this.#options.installDiagnosticPlugin(this.#options.activeDshHome, 'dsh-font')

      await this.#step(scenarioId, 'detect')
      resumeHarness()
      await this.#waitForClientModuleQuarantine('dsh-font')
      actualCode = fixture.code

      await this.#step(scenarioId, 'repair')
      await this.#step(scenarioId, 'verify')
      if (!await this.#hasClientModuleQuarantine('dsh-font')) {
        throw new Error('dsh-font was not durably quarantined after browser recovery')
      }
      await this.#step(scenarioId, 'retain')
      this.#appendResult({
        scenarioId,
        phase: 'passed',
        expectedCode: fixture.code,
        actualCode,
        repaired: true,
        retained: true,
        disposition: 'quarantined',
        durationMs: Date.now() - started,
      })
    } catch (error) {
      this.#appendResult({
        scenarioId,
        phase: this.#cancelled.has(active.runId) ? 'cancelled' : 'failed',
        expectedCode: fixture.code,
        ...(actualCode === undefined ? {} : { actualCode }),
        repaired: false,
        retained: existsSync(scenarioRoot),
        durationMs: Date.now() - started,
        diagnostic: sanitize(describeUnknown(error), this.#options.activeDshHome),
      })
      throw error
    }
  }

  async #waitForClientModuleQuarantine(packageName: 'dsh-font'): Promise<void> {
    const deadline = Date.now() + (this.#options.clientRecoveryTimeoutMs ?? 45_000)
    while (Date.now() <= deadline) {
      if (await this.#hasClientModuleQuarantine(packageName)) return
      await new Promise<void>((resolvePromise) => { setTimeout(resolvePromise, 200) })
    }
    throw new Error(`timed out waiting for browser recovery to quarantine ${packageName}`)
  }

  async #hasClientModuleQuarantine(packageName: 'dsh-font'): Promise<boolean> {
    return await this.#hasQuarantine(
      this.#options.activeDshHome,
      packageName,
      'client-module-unavailable',
      'profile.module-resolution',
    )
  }

  async #waitForSettingsSafeMode(home: string): Promise<void> {
    const deadline = Date.now() + (this.#options.clientRecoveryTimeoutMs ?? 45_000)
    while (Date.now() <= deadline) {
      try {
        const report = JSON.parse(await readFile(join(home, 'profile-health', 'web.diagnostics.json'), 'utf8')) as {
          issues?: Array<{ code?: unknown }>
          safeMode?: { skippedUserSettings?: unknown }
        }
        if (report.issues?.some(issue => issue.code === 'config.settings-invalid') === true
          && report.safeMode?.skippedUserSettings === true
          && existsSync(join(home, 'profile-health', 'safe-mode-settings.yaml'))) return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await new Promise<void>((resolvePromise) => { setTimeout(resolvePromise, 200) })
    }
    throw new Error('timed out waiting for invalid settings recovery to enter diagnostic safe mode')
  }

  async #hasQuarantine(
    home: string,
    packageName: string,
    reason: string,
    issueCode: string,
  ): Promise<boolean> {
    try {
      const quarantine = JSON.parse(await readFile(join(home, 'quarantine', 'profile-plugins.json'), 'utf8')) as {
        plugins?: Array<{ packageName?: unknown; reason?: unknown }>
      }
      const report = JSON.parse(await readFile(join(home, 'profile-health', 'web.json'), 'utf8')) as {
        status?: unknown
        quarantined?: Array<{ packageName?: unknown; reason?: unknown }>
        issues?: Array<{ code?: unknown; attribution?: { rootPackage?: unknown } }>
      }
      const manifest = JSON.parse(await readFile(join(home, 'profiles', 'web', 'package.json'), 'utf8')) as {
        dependencies?: Record<string, unknown>
        dsh?: { profile?: { bundles?: unknown[] } }
      }
      const durableRecord = quarantine.plugins?.some(record => (
        record.packageName === packageName && record.reason === reason
      )) === true
      const durableReport = report.status === 'quarantined'
        && report.quarantined?.some(record => (
          record.packageName === packageName && record.reason === reason
        )) === true
        && report.issues?.some(issue => (
          issue.code === issueCode && issue.attribution?.rootPackage === packageName
        )) === true
      const inactive = manifest.dependencies?.[packageName] === undefined
        && manifest.dsh?.profile?.bundles?.includes(packageName) !== true
      return durableRecord && durableReport && inactive
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  async #stageQuarantineRemovalResidue(home: string): Promise<void> {
    const profileDir = join(home, 'profiles', 'web')
    const packageName = '@dsh-diagnostic-lab/quarantine-removal-residue'
    const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, unknown>
      dsh?: { profile?: { bundles?: unknown[] } }
    }
    if (manifest.dependencies?.[packageName] !== undefined
      || manifest.dsh?.profile?.bundles?.includes(packageName) === true
      || existsSync(join(profileDir, 'node_modules', packageName, 'package.json'))) {
      throw new Error('diagnostic quarantine-removal fixture package is unexpectedly active')
    }

    const quarantinePath = join(home, 'quarantine', 'profile-plugins.json')
    if (existsSync(quarantinePath)) {
      const durable = JSON.parse(await readFile(quarantinePath, 'utf8')) as {
        plugins?: Array<{ packageName?: unknown }>
      }
      if (durable.plugins?.some(record => record.packageName === packageName) === true) {
        throw new Error('diagnostic quarantine-removal fixture is still durably quarantined')
      }
    }

    const now = (this.#options.now ?? (() => new Date()))().toISOString()
    const quarantineId = this.#requireActive().runId
    const staleIssue = {
      diagnosticId: randomUUID(),
      code: 'profile.module-resolution',
      source: 'profile',
      phase: 'repair',
      severity: 'blocked',
      attribution: { rootPackage: packageName },
      actions: ['restore', 'export'],
      evidence: ['legacy quarantine uninstall left derived Profile state'],
    }
    const staleRecord = {
      quarantineId,
      profile: 'web',
      packageName,
      packageSpec: '1.0.0',
      installedVersion: '1.0.0',
      bundleIndex: 0,
      quarantinedAt: now,
      reason: 'client-module-unavailable',
      conflicts: [],
    }
    const repairPath = join(home, 'profile-health', 'web.json')
    const previousRepair = existsSync(repairPath)
      ? JSON.parse(await readFile(repairPath, 'utf8')) as Record<string, unknown>
      : undefined
    if (previousRepair !== undefined && previousRepair.schema !== 'dsh/profile-dependency-repair/v1') {
      throw new Error('diagnostic quarantine-removal fixture found an unsupported repair report')
    }
    await atomicWrite(repairPath, `${JSON.stringify({
      ...previousRepair,
      schema: 'dsh/profile-dependency-repair/v1',
      diagnosticSchema: 'dsh/profile-diagnostic/v2',
      profile: 'web',
      status: 'quarantined',
      conflicts: unknownArray(previousRepair?.conflicts),
      orphanedBundles: unknownArray(previousRepair?.orphanedBundles),
      quarantined: [
        ...unknownArray(previousRepair?.quarantined),
        staleRecord,
      ],
      issues: [
        ...unknownArray(previousRepair?.issues),
        staleIssue,
      ],
    }, undefined, 2)}\n`)

    const diagnosticPath = join(home, 'profile-health', 'web.diagnostics.json')
    const previousDiagnostic = existsSync(diagnosticPath)
      ? JSON.parse(await readFile(diagnosticPath, 'utf8')) as Record<string, unknown>
      : undefined
    if (previousDiagnostic !== undefined && previousDiagnostic.schema !== 'dsh/profile-diagnostic/v2') {
      throw new Error('diagnostic quarantine-removal fixture found an unsupported diagnostic report')
    }
    await atomicWrite(diagnosticPath, `${JSON.stringify({
      ...previousDiagnostic,
      schema: 'dsh/profile-diagnostic/v2',
      profile: 'web',
      generatedAt: now,
      status: 'issues',
      issues: [
        ...unknownArray(previousDiagnostic?.issues),
        staleIssue,
      ],
    }, undefined, 2)}\n`)

    const lockfilePath = join(profileDir, 'pnpm-lock.yaml')
    const lockfile = parseDocument(existsSync(lockfilePath)
      ? await readFile(lockfilePath, 'utf8')
      : "lockfileVersion: '9.0'\n\nimporters:\n  .: {}\n")
    if (lockfile.errors.length > 0) {
      throw new Error(`diagnostic fixture lockfile is invalid: ${lockfile.errors[0]?.message ?? 'unknown YAML error'}`)
    }
    lockfile.setIn(['importers', '.', 'dependencies', packageName], {
      specifier: '1.0.0',
      version: '1.0.0',
    })
    await atomicWrite(lockfilePath, lockfile.toString())
  }

  async #stageProductionDoctorFixture(home: string, scenarioId: DiagnosticLabScenarioId): Promise<void> {
    if (scenarioId === 'quarantine-removal-residue') {
      await this.#stageQuarantineRemovalResidue(home)
      return
    }
    const profileDir = join(home, 'profiles', 'web')
    const manifestPath = join(profileDir, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    const packageName = `@dsh-diagnostic-lab/${scenarioId}`
    const fixtureRoot = join(home, 'diagnostic-fixtures', this.#requireActive().runId)
    const fixtureDir = join(fixtureRoot, scenarioId)
    const installedDir = join(profileDir, 'node_modules', packageName)
    await atomicWrite(join(fixtureDir, 'package.json'), `${JSON.stringify({
      name: packageName,
      version: '1.0.0',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
      ...(scenarioId === 'host-shadow-compatible'
        ? { dependencies: { '@deepseek-ai/dsh-tools': '*' } }
        : scenarioId === 'host-shadow-incompatible'
          ? { dependencies: { '@deepseek-ai/dsh-tools': '<0.0.0' } }
          : {}),
    }, undefined, 2)}\n`)
    await atomicWrite(join(fixtureDir, 'cordis.patch.yml'), '[]\n')
    manifest.dependencies ??= {}
    manifest.dependencies[packageName] = `file:${relative(profileDir, fixtureDir).split(sep).join('/')}`
    manifest.dsh ??= {}
    manifest.dsh.profile ??= {}
    manifest.dsh.profile.bundles ??= []
    if (!manifest.dsh.profile.bundles.includes(packageName)) manifest.dsh.profile.bundles.push(packageName)
    await atomicWrite(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
    if (scenarioId !== 'orphaned-bundle') {
      await atomicWrite(join(installedDir, 'package.json'), `${JSON.stringify({
        name: packageName,
        version: '1.0.0',
        dependencies: scenarioId === 'host-shadow-compatible'
          ? { '@deepseek-ai/dsh-tools': '*' }
          : { '@deepseek-ai/dsh-tools': '<0.0.0' },
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }, undefined, 2)}\n`)
      await atomicWrite(join(installedDir, 'cordis.patch.yml'), '[]\n')
      await atomicWrite(join(installedDir, 'node_modules', '@deepseek-ai', 'dsh-tools', 'package.json'), `${JSON.stringify({
        name: '@deepseek-ai/dsh-tools',
        version: '0.0.0-diagnostic',
      }, undefined, 2)}\n`)
    } else {
      manifest.dependencies = Object.fromEntries(
        Object.entries(manifest.dependencies).filter(([name]) => name !== packageName),
      )
      await atomicWrite(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
    }
  }

  async #detectScenario(path: string, fixture: ScenarioFixture): Promise<string | undefined> {
    if (!existsSync(path)) return undefined
    const content = await readFile(path, 'utf8')
    return content === fixture.content ? fixture.code : undefined
  }

  async #step(scenarioId: DiagnosticLabScenarioId, step: DiagnosticLabStep): Promise<void> {
    const current = this.#requireActive()
    this.#replace({
      ...current,
      currentScenarioId: scenarioId,
      currentStep: step,
      completedSteps: Math.min(current.totalSteps, current.completedSteps + 1),
    })
    await Promise.resolve()
  }

  #appendResult(result: DiagnosticLabScenarioResult): void {
    const current = this.#requireActive()
    this.#replace({ ...current, results: [...current.results, result] })
  }

  async #backupActiveProfile(runRoot: string, journal: DiagnosticLabJournal): Promise<DiagnosticLabJournal> {
    const backupRoot = join(runRoot, 'backup')
    const files: JournalFile[] = []
    for (const relativePath of MANAGED_PROFILE_FILES) {
      const source = join(this.#options.activeDshHome, relativePath)
      const existed = existsSync(source)
      if (existed && !(await stat(source)).isFile()) throw new Error(`desktop: managed profile path is not a file: ${relativePath}`)
      const content = existed ? await readFile(source) : undefined
      files.push({ relativePath, existed, ...(content === undefined ? {} : { sha256: sha256(content) }) })
      if (content !== undefined) await atomicWrite(join(backupRoot, relativePath), content.toString('utf8'))
    }
    return { ...journal, backupRoot, files }
  }

  async #restoreActiveProfile(runRoot: string, journal: DiagnosticLabJournal | LegacyDiagnosticLabJournal): Promise<void> {
    if (journal.backupRoot === undefined) return
    assertInside(runRoot, journal.backupRoot)
    for (const file of journal.files) {
      const destination = join(this.#options.activeDshHome, file.relativePath)
      if (!file.existed) {
        await rm(destination, { force: true })
        continue
      }
      const backup = await readFile(join(journal.backupRoot, file.relativePath))
      if (sha256(backup) !== file.sha256) throw new Error(`desktop: diagnostic backup checksum mismatch: ${file.relativePath}`)
      await atomicWrite(destination, backup.toString('utf8'))
    }
  }

  async #restoreRun(runRoot: string, journal: DiagnosticLabJournal | LegacyDiagnosticLabJournal): Promise<void> {
    if (journal.target === 'active-profile' && journal.backupRoot !== undefined) {
      await this.#restoreActiveProfile(runRoot, journal)
      await this.#removeRunResidue(journal)
      await this.#options.installProfile(this.#options.activeDshHome, true)
      await this.#restoreActiveProfile(runRoot, journal)
      await this.#verifyRestoredProfile(journal)
    } else {
      await rm(join(runRoot, 'runtime'), { recursive: true, force: true })
    }
    const clean: DiagnosticLabJournal = {
      ...journal,
      schema: 2,
      state: 'clean',
    }
    await this.#writeJournal(runRoot, clean)
  }

  async #removeRunResidue(journal: DiagnosticLabJournal | LegacyDiagnosticLabJournal): Promise<void> {
    const profileDir = join(this.#options.activeDshHome, 'profiles', 'web')
    const runMarker = journal.runId.slice(0, 16)
    await removeWithoutFollowing(join(profileDir, '.diagnostic-lab', journal.runId))
    await removeWithoutFollowing(join(this.#options.activeDshHome, 'diagnostic-fixtures', journal.runId))
    for (const scenarioId of PRODUCTION_DOCTOR_SCENARIOS) {
      await removeWithoutFollowing(join(profileDir, 'node_modules', DIAGNOSTIC_PACKAGE_SCOPE, scenarioId))
    }
    const virtualStore = join(profileDir, 'node_modules', '.pnpm')
    if (await pathExists(virtualStore)) {
      for (const entry of await readdir(virtualStore, { withFileTypes: true })) {
        const path = join(virtualStore, entry.name)
        const ownedEntry = entry.name.includes('diagnostic-fixtures') && entry.name.includes(runMarker)
        const linksToRun = !ownedEntry && entry.isDirectory() && await treeLinksToRun(path, journal.runId)
        if (ownedEntry || linksToRun) await removeWithoutFollowing(path)
      }
    }
  }

  async #hasRunResidue(journal: DiagnosticLabJournal | LegacyDiagnosticLabJournal): Promise<boolean> {
    if (journal.target !== 'active-profile') return false
    const profileDir = join(this.#options.activeDshHome, 'profiles', 'web')
    const runMarker = journal.runId.slice(0, 16)
    if (await pathExists(join(profileDir, '.diagnostic-lab', journal.runId))
      || await pathExists(join(this.#options.activeDshHome, 'diagnostic-fixtures', journal.runId))) return true
    for (const scenarioId of PRODUCTION_DOCTOR_SCENARIOS) {
      if (await pathExists(join(profileDir, 'node_modules', DIAGNOSTIC_PACKAGE_SCOPE, scenarioId))) return true
    }
    const virtualStore = join(profileDir, 'node_modules', '.pnpm')
    if (!await pathExists(virtualStore)) return false
    for (const entry of await readdir(virtualStore, { withFileTypes: true })) {
      if (entry.name.includes('diagnostic-fixtures') && entry.name.includes(runMarker)) return true
      if (entry.isDirectory() && await treeLinksToRun(join(virtualStore, entry.name), journal.runId)) return true
    }
    return false
  }

  async #verifyRestoredProfile(journal: DiagnosticLabJournal | LegacyDiagnosticLabJournal): Promise<void> {
    for (const file of journal.files) {
      const destination = join(this.#options.activeDshHome, file.relativePath)
      if (!file.existed) {
        if (await pathExists(destination)) throw new Error(`desktop: diagnostic recovery retained ${file.relativePath}`)
        continue
      }
      const content = await readFile(destination)
      if (sha256(content) !== file.sha256) throw new Error(`desktop: diagnostic recovery changed ${file.relativePath}`)
    }
    if (await this.#hasRunResidue(journal)) throw new Error('desktop: diagnostic recovery retained a test dependency link')
    const doctor = await this.#options.runDoctor(this.#options.activeDshHome, false)
    if (!['healthy', 'repaired', 'quarantined'].includes(doctor.status)) {
      throw new Error(`desktop: diagnostic recovery Doctor failed with status ${doctor.status}`)
    }
  }

  async #recoveryFailureSnapshot(
    runRoot: string,
    journal: DiagnosticLabJournal | LegacyDiagnosticLabJournal,
    error: unknown,
  ): Promise<DiagnosticLabRunSnapshot> {
    let previous: DiagnosticLabRunSnapshot | undefined
    try {
      previous = await this.#readAnyReport(runRoot)
    } catch (reportError) {
      console.warn('desktop: could not reuse the previous diagnostic lab report during recovery', reportError)
    }
    const failed: DiagnosticLabRunSnapshot = {
      schema: 2,
      runId: journal.runId,
      target: journal.target,
      scenarioIds: previous?.scenarioIds ?? [],
      phase: 'failed',
      completedSteps: previous?.completedSteps ?? 0,
      totalSteps: previous?.totalSteps ?? 0,
      recovery: 'failed',
      startedAt: previous?.startedAt ?? (this.#options.now ?? (() => new Date()))().toISOString(),
      finishedAt: (this.#options.now ?? (() => new Date()))().toISOString(),
      results: previous?.results ?? [],
      diagnostic: sanitize(describeUnknown(error), this.#options.activeDshHome),
    }
    await this.#writeJournal(runRoot, { ...journal, schema: 2, state: 'restoring' })
    await this.#writeReport(runRoot, failed)
    return failed
  }

  async #readJournal(runRoot: string): Promise<DiagnosticLabJournal | LegacyDiagnosticLabJournal | undefined> {
    const path = join(runRoot, 'recovery.json')
    if (!existsSync(path)) return undefined
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<DiagnosticLabJournal | LegacyDiagnosticLabJournal>
    if ((value.schema !== 1 && value.schema !== 2)
      || value.runId !== runRoot.split(/[\\/]/u).at(-1)
      || !Array.isArray(value.files)) {
      throw new Error(`desktop: unsupported diagnostic recovery journal ${path}`)
    }
    return value as DiagnosticLabJournal | LegacyDiagnosticLabJournal
  }

  async #writeJournal(runRoot: string, journal: DiagnosticLabJournal): Promise<void> {
    await atomicWrite(join(runRoot, 'recovery.json'), `${JSON.stringify(journal, undefined, 2)}\n`)
  }

  async #writeReport(runRoot: string, snapshot: DiagnosticLabRunSnapshot): Promise<void> {
    await mkdir(this.#options.logDirectory, { recursive: true, mode: 0o700 })
    const json = `${JSON.stringify(snapshot, undefined, 2)}\n`
    const summary = textReport(snapshot)
    await atomicWrite(join(runRoot, 'report.json'), json)
    await atomicWrite(join(runRoot, 'report.txt'), summary)
    await atomicWrite(join(this.#options.logDirectory, `${snapshot.runId}.json`), json)
    await atomicWrite(join(this.#options.logDirectory, `${snapshot.runId}.txt`), summary)
  }

  async #readReport(runRoot: string): Promise<DiagnosticLabRunSnapshot> {
    const path = join(runRoot, 'report.json')
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<DiagnosticLabRunSnapshot>
    if (value.schema !== 2 || value.runId !== runRoot.split(/[\\/]/u).at(-1) || value.phase !== 'active') {
      throw new Error(`desktop: unsupported retained diagnostic report ${path}`)
    }
    return value as DiagnosticLabRunSnapshot
  }

  async #readAnyReport(runRoot: string): Promise<DiagnosticLabRunSnapshot> {
    const path = join(runRoot, 'report.json')
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<DiagnosticLabRunSnapshot>
    if (value.schema !== 2 || value.runId !== runRoot.split(/[\\/]/u).at(-1)) {
      throw new Error(`desktop: unsupported diagnostic report ${path}`)
    }
    return value as DiagnosticLabRunSnapshot
  }

  #replace(snapshot: DiagnosticLabRunSnapshot): void {
    this.#active = snapshot
    this.#publish(snapshot)
  }

  #requireActive(runId?: string): DiagnosticLabRunSnapshot {
    const active = this.#active
    if (active === undefined || (runId !== undefined && active.runId !== runId)) {
      throw new Error('desktop: diagnostic lab run state is unavailable')
    }
    return active
  }

  #publish(snapshot: DiagnosticLabRunSnapshot): void {
    this.#options.onSnapshot(cloneSnapshot(snapshot))
  }
}
