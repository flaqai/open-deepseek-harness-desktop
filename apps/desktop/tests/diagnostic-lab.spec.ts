import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  DiagnosticLabManager,
  type DiagnosticLabRunSnapshot,
  type DiagnosticLabStartRequest,
} from '../src/diagnostic-lab.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function bench(): Promise<{
  root: string
  home: string
  manager: DiagnosticLabManager
  snapshots: DiagnosticLabRunSnapshot[]
  suspendHarness: Mock<() => Promise<void>>
  resumeHarness: Mock<() => void>
  installProfile: Mock<(home: string, force: boolean) => Promise<void>>
  installDiagnosticPlugin: Mock<(home: string, packageName:
    | 'dsh-font'
    | '@dsh-diagnostic-lab/scoped-loader-mismatch'
    | '@dsh-diagnostic-lab/loader-dependency-unavailable') => Promise<void>>
  runDoctor: Mock<() => Promise<{ status: string; issueCodes: string[]; output: string }>>
  runStartupTimeoutExercise: Mock<() => Promise<{
    actualCode: 'runtime.profile-check-timeout'
    cancelled: boolean
    rolledBack: boolean
    continued: boolean
  }>>
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-diagnostic-lab-'))
  roots.push(root)
  const home = join(root, 'active-home')
  await mkdir(join(home, 'profiles', 'web'), { recursive: true })
  await writeFile(join(home, 'profiles', 'web', 'package.json'), '{"name":"dsh-profile-web","private":true}\n')
  const snapshots: DiagnosticLabRunSnapshot[] = []
  const suspendHarness = vi.fn<() => Promise<void>>(async () => {})
  const resumeHarness = vi.fn<() => void>(() => {})
  const installProfile = vi.fn<(home: string, force: boolean) => Promise<void>>(async () => {})
  const installDiagnosticPlugin = vi.fn(async (
    targetHome: string,
    packageName:
      | 'dsh-font'
      | '@dsh-diagnostic-lab/scoped-loader-mismatch'
      | '@dsh-diagnostic-lab/loader-dependency-unavailable',
  ) => {
    if (packageName === 'dsh-font') return
    await mkdir(join(targetHome, 'profiles', 'web'), { recursive: true })
    await mkdir(join(targetHome, 'quarantine'), { recursive: true })
    await mkdir(join(targetHome, 'profile-health'), { recursive: true })
    await writeFile(join(targetHome, 'profiles', 'web', 'package.json'), JSON.stringify({
      name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
    }))
    const dependencyFailure = packageName === '@dsh-diagnostic-lab/loader-dependency-unavailable'
    const reason = dependencyFailure ? 'loader-dependency-unavailable' : 'loader-module-unresolvable'
    const issueCode = dependencyFailure ? 'loader.dependency-unavailable' : 'profile.module-resolution'
    const record = { packageName, reason }
    await writeFile(join(targetHome, 'quarantine', 'profile-plugins.json'), JSON.stringify({
      schema: 1, plugins: [record],
    }))
    await writeFile(join(targetHome, 'profile-health', 'web.json'), JSON.stringify({
      status: 'quarantined', quarantined: [record],
      issues: [{ code: issueCode, attribution: { rootPackage: packageName } }],
    }))
  })
  const runDoctor = vi.fn(async () => ({ status: 'healthy', issueCodes: [], output: '{}' }))
  const runStartupTimeoutExercise = vi.fn(async () => ({
    actualCode: 'runtime.profile-check-timeout' as const,
    cancelled: true,
    rolledBack: true,
    continued: true,
  }))
  const manager = new DiagnosticLabManager({
    root: join(root, 'lab'),
    activeDshHome: home,
    logDirectory: join(root, 'logs'),
    suspendHarness,
    resumeHarness,
    installProfile,
    installDiagnosticPlugin,
    runDoctor,
    runStartupTimeoutExercise,
    productionDoctorFixtures: false,
    onSnapshot: (snapshot) => { snapshots.push(snapshot) },
  })
  return {
    root, home, manager, snapshots, suspendHarness, resumeHarness, installProfile, installDiagnosticPlugin, runDoctor,
    runStartupTimeoutExercise,
  }
}

async function waitForTerminal(manager: DiagnosticLabManager, runId: string): Promise<DiagnosticLabRunSnapshot> {
  for (let count = 0; count < 200; count += 1) {
    const snapshot = manager.get(runId)
    if (snapshot.phase === 'active' || snapshot.phase === 'restored' || snapshot.phase === 'failed' || snapshot.phase === 'cancelled') return snapshot
    await new Promise((resolve) => { setTimeout(resolve, 5) })
  }
  throw new Error('diagnostic lab test run did not settle')
}

describe('DiagnosticLabManager', () => {
  it('runs every reviewed isolated scenario once and retains its runtime until Restore all', async () => {
    const b = await bench()
    const scenarioIds = b.manager.catalog()
      .filter(scenario => scenario.targets.includes('isolated'))
      .map(scenario => scenario.id)
    const initial = b.manager.start({ scenarioIds, target: 'isolated' })
    expect(b.manager.current()?.runId).toBe(initial.runId)
    const final = await waitForTerminal(b.manager, initial.runId)

    expect(final.phase, final.diagnostic).toBe('active')
    expect(final.results).toHaveLength(scenarioIds.length)
    expect(final.results.every(result => result.phase === 'passed' && result.retained)).toBe(true)
    expect(final.completedSteps).toBe(final.totalSteps)
    const directLoaderScenarios = scenarioIds.filter(id => (
      id === 'loader-package-name-mismatch' || id === 'loader-dependency-unavailable'
    )).length
    const settingsScenarios = scenarioIds.filter(id => id === 'settings-invalid').length
    const startupTimeoutScenarios = scenarioIds.filter(id => id === 'startup-operation-timeout').length
    expect(b.runDoctor).toHaveBeenCalledTimes(
      (scenarioIds.length - directLoaderScenarios - settingsScenarios - startupTimeoutScenarios) * 4
      + directLoaderScenarios,
    )
    expect(b.runStartupTimeoutExercise).toHaveBeenCalledTimes(startupTimeoutScenarios)
    expect(b.suspendHarness).not.toHaveBeenCalled()
    expect(b.resumeHarness).not.toHaveBeenCalled()
    expect(existsSync(join(b.root, 'lab', 'runs', initial.runId, 'runtime'))).toBe(true)
    expect(JSON.parse(b.manager.exportReport(initial.runId))).toMatchObject({ runId: initial.runId, phase: 'active' })
    await expect(b.manager.restoreAll(initial.runId)).resolves.toMatchObject({ phase: 'restored' })
    expect(existsSync(join(b.root, 'lab', 'runs', initial.runId, 'runtime'))).toBe(false)
  })

  it('installs production fixtures before requiring convergence and quarantine outcomes', async () => {
    const b = await bench()
    const calls = new Map<string, number>()
    const runDoctor = vi.fn(async (home: string) => {
      const scenarioId = home.split('/').at(-1) ?? ''
      const call = (calls.get(home) ?? 0) + 1
      calls.set(home, call)
      if (call === 1) {
        const profileDir = join(home, 'profiles', 'web')
        await mkdir(profileDir, { recursive: true })
        await writeFile(join(profileDir, 'package.json'), '{"name":"dsh-profile-web","private":true}\n')
        await writeFile(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\n')
      }
      if (call === 2) {
        const issueCode = scenarioId === 'orphaned-bundle'
          ? 'profile.orphaned-bundle'
          : scenarioId === 'quarantine-removal-residue'
            ? 'profile.quarantine-removal-residue'
            : 'profile.host-dependency-conflict'
        return { status: 'failed', issueCodes: [issueCode], output: '{}' }
      }
      if (call === 3) {
        return {
          status: scenarioId === 'host-shadow-compatible' || scenarioId === 'quarantine-removal-residue'
            ? 'repaired'
            : 'quarantined',
          issueCodes: [],
          output: '{}',
        }
      }
      return { status: 'healthy', issueCodes: [], output: '{}' }
    })
    const manager = new DiagnosticLabManager({
      root: join(b.root, 'production-lab'),
      activeDshHome: b.home,
      logDirectory: join(b.root, 'production-logs'),
      suspendHarness: b.suspendHarness,
      resumeHarness: b.resumeHarness,
      installProfile: b.installProfile,
      installDiagnosticPlugin: b.installDiagnosticPlugin,
      runDoctor,
      onSnapshot: () => {},
    })
    const initial = manager.start({
      scenarioIds: [
        'host-shadow-compatible',
        'host-shadow-incompatible',
        'orphaned-bundle',
        'quarantine-removal-residue',
      ],
      target: 'isolated',
    })
    const final = await waitForTerminal(manager, initial.runId)

    expect(final.phase).toBe('active')
    expect(final.results.every(result => result.phase === 'passed')).toBe(true)
    expect(b.installProfile).not.toHaveBeenCalled()
    expect(runDoctor).toHaveBeenCalledTimes(16)
    for (const home of calls.keys()) {
      const workspace = await readFile(join(home, 'profiles', 'web', 'pnpm-workspace.yaml'), 'utf8')
      expect(workspace).toBe('packages:\n  - .\n\nnodeLinker: hoisted\n')
      expect(workspace).not.toContain('@deepseek-ai/dsh-tools')
    }
  })

  it('stages and restores the real legacy quarantine-removal residue shape', async () => {
    const b = await bench()
    await writeFile(join(b.home, 'profiles', 'web', 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\n')
    let call = 0
    const runDoctor = vi.fn(async () => {
      call += 1
      const repairPath = join(b.home, 'profile-health', 'web.json')
      const diagnosticPath = join(b.home, 'profile-health', 'web.diagnostics.json')
      const lockfilePath = join(b.home, 'profiles', 'web', 'pnpm-lock.yaml')
      if (call === 1) return { status: 'healthy', issueCodes: [], output: '{}' }
      if (call === 2) {
        expect(await readFile(repairPath, 'utf8')).toContain('@dsh-diagnostic-lab/quarantine-removal-residue')
        expect(await readFile(diagnosticPath, 'utf8')).toContain('profile.module-resolution')
        expect(await readFile(lockfilePath, 'utf8')).toContain('@dsh-diagnostic-lab/quarantine-removal-residue')
        return { status: 'failed', issueCodes: ['profile.quarantine-removal-residue'], output: '{}' }
      }
      if (call === 3) {
        await rm(repairPath, { force: true })
        await rm(diagnosticPath, { force: true })
        await writeFile(lockfilePath, "lockfileVersion: '9.0'\n\nimporters:\n  .: {}\n")
        return { status: 'repaired', issueCodes: [], output: '{}' }
      }
      return { status: 'healthy', issueCodes: [], output: '{}' }
    })
    const manager = new DiagnosticLabManager({
      root: join(b.root, 'quarantine-removal-lab'),
      activeDshHome: b.home,
      logDirectory: join(b.root, 'quarantine-removal-logs'),
      suspendHarness: b.suspendHarness,
      resumeHarness: b.resumeHarness,
      installProfile: b.installProfile,
      installDiagnosticPlugin: b.installDiagnosticPlugin,
      runDoctor,
      onSnapshot: () => {},
    })
    const initial = manager.start({
      scenarioIds: ['quarantine-removal-residue'],
      target: 'active-profile',
    })
    const active = await waitForTerminal(manager, initial.runId)

    expect(active).toMatchObject({ phase: 'active', recovery: 'retained' })
    expect(active.results).toEqual([expect.objectContaining({
      scenarioId: 'quarantine-removal-residue',
      actualCode: 'profile.quarantine-removal-residue',
      disposition: 'repaired',
    })])
    await expect(manager.restoreAll(initial.runId)).resolves.toMatchObject({ phase: 'restored' })
    expect(existsSync(join(b.home, 'profile-health', 'web.json'))).toBe(false)
    expect(existsSync(join(b.home, 'profile-health', 'web.diagnostics.json'))).toBe(false)
  })

  it('persists a real current-Profile quarantine for the ordinary diagnostics summary', async () => {
    const b = await bench()
    await writeFile(join(b.home, 'profiles', 'web', 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\n')
    let call = 0
    const quarantinePath = join(b.home, 'quarantine', 'profile-plugins.json')
    const runDoctor = vi.fn(async () => {
      call += 1
      if (call === 1) return { status: 'healthy', issueCodes: [], output: '{}' }
      if (call === 2) return { status: 'failed', issueCodes: ['profile.orphaned-bundle'], output: '{}' }
      if (call === 3) {
        await mkdir(join(b.home, 'quarantine'), { recursive: true })
        await writeFile(quarantinePath, '{"schema":1,"plugins":[{"packageName":"@dsh-diagnostic-lab/orphaned-bundle"}]}\n')
      }
      return { status: 'quarantined', issueCodes: [], output: '{}' }
    })
    const manager = new DiagnosticLabManager({
      root: join(b.root, 'active-production-lab'),
      activeDshHome: b.home,
      logDirectory: join(b.root, 'active-production-logs'),
      suspendHarness: b.suspendHarness,
      resumeHarness: b.resumeHarness,
      installProfile: b.installProfile,
      installDiagnosticPlugin: b.installDiagnosticPlugin,
      runDoctor,
      onSnapshot: () => {},
    })
    const initial = manager.start({ scenarioIds: ['orphaned-bundle'], target: 'active-profile' })
    const active = await waitForTerminal(manager, initial.runId)

    expect(active).toMatchObject({ phase: 'active', recovery: 'retained' })
    expect(active.results[0]).toMatchObject({ disposition: 'quarantined', retained: true })
    expect(existsSync(quarantinePath)).toBe(true)
    expect(b.resumeHarness).toHaveBeenCalledOnce()

    await expect(manager.restoreAll(initial.runId)).resolves.toMatchObject({ phase: 'restored' })
    expect(existsSync(quarantinePath)).toBe(false)
    expect(b.installProfile).toHaveBeenCalledTimes(1)
    expect(b.installProfile).toHaveBeenLastCalledWith(b.home, true)
  })

  it('isolates a resolvable Loader whose published entry has a missing internal dependency', async () => {
    const b = await bench()
    const packageName = '@dsh-diagnostic-lab/loader-dependency-unavailable'
    const initial = b.manager.start({
      scenarioIds: ['loader-dependency-unavailable'],
      target: 'active-profile',
    })
    const active = await waitForTerminal(b.manager, initial.runId)

    expect(active).toMatchObject({ phase: 'active', recovery: 'retained' })
    expect(active.results).toEqual([expect.objectContaining({
      scenarioId: 'loader-dependency-unavailable',
      actualCode: 'loader.dependency-unavailable',
      disposition: 'quarantined',
    })])
    expect(b.installDiagnosticPlugin).toHaveBeenCalledWith(b.home, packageName)
    expect(await readFile(join(b.home, 'profile-health', 'web.json'), 'utf8'))
      .toContain('loader.dependency-unavailable')

    await expect(b.manager.restoreAll(initial.runId)).resolves.toMatchObject({ phase: 'restored' })
    expect(existsSync(join(b.home, 'quarantine', 'profile-plugins.json'))).toBe(false)
    expect(existsSync(join(b.home, 'profile-health', 'web.json'))).toBe(false)
  })

  it('retains invalid settings in real safe mode and restores the exact original document', async () => {
    const b = await bench()
    const settingsPath = join(b.home, 'settings.yaml')
    const original = 'locale: zh\r\nui-theme:\r\n  preference: ocean\r\n'
    await writeFile(settingsPath, original)
    let recoveryScheduled = false
    const resumeHarness = vi.fn(() => {
      if (recoveryScheduled) return
      recoveryScheduled = true
      void (async () => {
        await new Promise((resolve) => { setTimeout(resolve, 15) })
        await mkdir(join(b.home, 'profile-health'), { recursive: true })
        await writeFile(join(b.home, 'profile-health', 'safe-mode-settings.yaml'), '{}\n')
        await writeFile(join(b.home, 'profile-health', 'web.diagnostics.json'), JSON.stringify({
          schema: 'dsh/profile-diagnostic/v2',
          profile: 'web',
          status: 'issues',
          issues: [{ code: 'config.settings-invalid' }],
          safeMode: { skippedUserSettings: true },
        }))
      })()
    })
    const manager = new DiagnosticLabManager({
      root: join(b.root, 'settings-invalid-lab'),
      activeDshHome: b.home,
      logDirectory: join(b.root, 'settings-invalid-logs'),
      suspendHarness: b.suspendHarness,
      resumeHarness,
      installProfile: b.installProfile,
      installDiagnosticPlugin: b.installDiagnosticPlugin,
      runDoctor: b.runDoctor,
      productionDoctorFixtures: false,
      clientRecoveryTimeoutMs: 1_000,
      onSnapshot: () => {},
    })

    const initial = manager.start({ scenarioIds: ['settings-invalid'], target: 'active-profile' })
    const active = await waitForTerminal(manager, initial.runId)

    expect(active).toMatchObject({ phase: 'active', recovery: 'retained' })
    expect(active.results).toEqual([expect.objectContaining({
      scenarioId: 'settings-invalid',
      actualCode: 'config.settings-invalid',
      disposition: 'retained',
    })])
    expect(await readFile(settingsPath, 'utf8'))
      .toBe('diagnostic-lab-duplicate: one\ndiagnostic-lab-duplicate: two\n')
    expect(resumeHarness).toHaveBeenCalledOnce()

    await expect(manager.restoreAll(initial.runId)).resolves.toMatchObject({ phase: 'restored' })
    expect(await readFile(settingsPath, 'utf8')).toBe(original)
    expect(existsSync(join(b.home, 'profile-health', 'safe-mode-settings.yaml'))).toBe(false)
    expect(existsSync(join(b.home, 'profile-health', 'web.diagnostics.json'))).toBe(false)
  })

  it('installs packaged dsh-font only for the active exercise and observes real client quarantine', async () => {
    const b = await bench()
    const manifestPath = join(b.home, 'profiles', 'web', 'package.json')
    const installDiagnosticPlugin = vi.fn(async (
      home: string,
      packageName:
        | 'dsh-font'
        | '@dsh-diagnostic-lab/scoped-loader-mismatch'
        | '@dsh-diagnostic-lab/loader-dependency-unavailable',
    ) => {
      expect(home).toBe(b.home)
      expect(packageName).toBe('dsh-font')
      await writeFile(manifestPath, `${JSON.stringify({
        name: 'dsh-profile-web',
        private: true,
        dependencies: { 'dsh-font': 'file:diagnostic-dsh-font-1.1.0.tgz' },
        dsh: { profile: { bundles: ['dsh-font'] } },
      })}\n`)
    })
    let recoveryScheduled = false
    const resumeHarness = vi.fn(() => {
      if (recoveryScheduled) return
      recoveryScheduled = true
      void (async () => {
        await new Promise((resolve) => { setTimeout(resolve, 15) })
        await mkdir(join(b.home, 'quarantine'), { recursive: true })
        await mkdir(join(b.home, 'profile-health'), { recursive: true })
        await writeFile(join(b.home, 'profile-health', 'web.json'), JSON.stringify({
          status: 'quarantined',
          quarantined: [{ packageName: 'dsh-font', reason: 'client-module-unavailable' }],
          issues: [{ code: 'profile.module-resolution', attribution: { rootPackage: 'dsh-font' } }],
        }))
        await writeFile(manifestPath, JSON.stringify({ name: 'dsh-profile-web', private: true }))
        await writeFile(join(b.home, 'quarantine', 'profile-plugins.json'), JSON.stringify({
          schema: 1,
          plugins: [{ packageName: 'dsh-font', reason: 'client-module-unavailable' }],
        }))
      })()
    })
    const manager = new DiagnosticLabManager({
      root: join(b.root, 'client-module-lab'),
      activeDshHome: b.home,
      logDirectory: join(b.root, 'client-module-logs'),
      suspendHarness: b.suspendHarness,
      resumeHarness,
      installProfile: b.installProfile,
      installDiagnosticPlugin,
      runDoctor: b.runDoctor,
      productionDoctorFixtures: false,
      clientRecoveryTimeoutMs: 1_000,
      onSnapshot: () => {},
    })

    const initial = manager.start({ scenarioIds: ['client-module-unavailable'], target: 'active-profile' })
    const active = await waitForTerminal(manager, initial.runId)

    expect(active).toMatchObject({ phase: 'active', recovery: 'retained' })
    expect(active.results).toEqual([
      expect.objectContaining({
        scenarioId: 'client-module-unavailable',
        phase: 'passed',
        actualCode: 'profile.module-resolution',
        disposition: 'quarantined',
      }),
    ])
    expect(installDiagnosticPlugin).toHaveBeenCalledOnce()
    expect(resumeHarness).toHaveBeenCalledOnce()

    await expect(manager.restoreAll(initial.runId)).resolves.toMatchObject({ phase: 'restored' })
    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toEqual({ name: 'dsh-profile-web', private: true })
    expect(existsSync(join(b.home, 'quarantine', 'profile-plugins.json'))).toBe(false)
    expect(existsSync(join(b.home, 'profile-health', 'web.json'))).toBe(false)
  })

  it('injects every selected scenario exactly once', async () => {
    const b = await bench()
    const initial = b.manager.start({
      scenarioIds: ['host-shadow-compatible', 'orphaned-bundle'],
      target: 'isolated',
    })
    const final = await waitForTerminal(b.manager, initial.runId)
    expect(final.results).toHaveLength(2)
    expect(final.results.map(result => result.scenarioId)).toEqual(['host-shadow-compatible', 'orphaned-bundle'])
    expect(final.phase).toBe('active')
  })

  it('cancels at a safe boundary, cleans runtime, and rejects a concurrent run', async () => {
    const b = await bench()
    const initial = b.manager.start({
      scenarioIds: b.manager.catalog()
        .filter(scenario => scenario.targets.includes('isolated'))
        .map(scenario => scenario.id),
      target: 'isolated',
    })
    expect(() => b.manager.start({
      scenarioIds: ['orphaned-bundle'], target: 'isolated',
    })).toThrow('another diagnostic lab run is active')
    b.manager.cancel(initial.runId)
    const final = await waitForTerminal(b.manager, initial.runId)
    expect(final.phase).toBe('cancelled')
    expect(existsSync(join(b.root, 'lab', 'runs', initial.runId, 'runtime'))).toBe(false)
  })

  it('rejects arbitrary and target-incompatible scenario requests', async () => {
    const b = await bench()
    expect(() => b.manager.start({ scenarioIds: [], target: 'isolated' })).toThrow('invalid')
    expect(() => b.manager.start({
      scenarioIds: ['patch-invalid'],
      target: 'active-profile',
    })).toThrow('unavailable')
    expect(() => b.manager.start({
      scenarioIds: ['arbitrary-command' as never],
      target: 'isolated',
    })).toThrow('invalid')
  })

  it('pauses the active Harness and retains the exercise until explicit restoration', async () => {
    const b = await bench()
    const manifest = join(b.home, 'profiles', 'web', 'package.json')
    const before = await readFile(manifest, 'utf8')
    const request: DiagnosticLabStartRequest = {
      scenarioIds: ['host-shadow-compatible'],
      target: 'active-profile',
    }
    const initial = b.manager.start(request)
    const final = await waitForTerminal(b.manager, initial.runId)

    expect(final.phase).toBe('active')
    expect(final.recovery).toBe('retained')
    expect(b.suspendHarness).toHaveBeenCalledOnce()
    expect(b.resumeHarness).toHaveBeenCalledOnce()
    expect(await readFile(manifest, 'utf8')).toBe(before)
    expect(existsSync(join(b.home, 'profiles', 'web', '.diagnostic-lab', initial.runId))).toBe(true)
    expect(await readFile(join(b.root, 'logs', `${initial.runId}.txt`), 'utf8'))
      .toContain('[PASSED] host-shadow-compatible')
    const restored = await b.manager.restoreAll(initial.runId)
    expect(restored.phase).toBe('restored')
    expect(b.suspendHarness).toHaveBeenCalledTimes(2)
    expect(b.resumeHarness).toHaveBeenCalledTimes(2)
    expect(await readFile(manifest, 'utf8')).toBe(before)
    expect(existsSync(join(b.home, 'profiles', 'web', '.diagnostic-lab', initial.runId))).toBe(false)
  })

  it('keeps Harness stopped and Restore all retryable when restoration fails', async () => {
    const b = await bench()
    const initial = b.manager.start({
      scenarioIds: ['host-shadow-compatible'],
      target: 'active-profile',
    })
    expect((await waitForTerminal(b.manager, initial.runId)).phase).toBe('active')
    b.installProfile.mockRejectedValueOnce(new Error('fixture install failed'))

    await expect(b.manager.restoreAll(initial.runId)).rejects.toThrow('fixture install failed')
    expect(b.manager.get(initial.runId)).toMatchObject({ phase: 'active', recovery: 'failed' })
    expect(b.resumeHarness).toHaveBeenCalledTimes(1)

    b.installProfile.mockRejectedValue(new Error('dependency graph is still unavailable'))
    const restarted = new DiagnosticLabManager({
      root: join(b.root, 'lab'),
      activeDshHome: b.home,
      logDirectory: join(b.root, 'logs'),
      suspendHarness: b.suspendHarness,
      resumeHarness: b.resumeHarness,
      installProfile: b.installProfile,
      installDiagnosticPlugin: b.installDiagnosticPlugin,
      runDoctor: b.runDoctor,
      productionDoctorFixtures: false,
      onSnapshot: () => {},
    })
    await expect(restarted.recoverPending()).resolves.toBeUndefined()
    expect(restarted.current()).toMatchObject({ phase: 'failed', recovery: 'failed' })
    expect(() => restarted.start({ scenarioIds: ['orphaned-bundle'], target: 'isolated' }))
      .toThrow('another diagnostic lab run is active')

    b.installProfile.mockResolvedValue(undefined)
    await expect(restarted.restoreAll(initial.runId)).resolves.toMatchObject({ phase: 'restored', recovery: 'clean' })
    expect(b.resumeHarness).toHaveBeenCalledTimes(2)
  })

  it('redacts active home and credential values in failures', async () => {
    const b = await bench()
    const manager = new DiagnosticLabManager({
      root: join(b.root, 'redaction-lab'),
      activeDshHome: b.home,
      logDirectory: join(b.root, 'redaction-logs'),
      suspendHarness: async () => { throw new Error(`token=secret-value ${b.home}`) },
      resumeHarness: () => {},
      installProfile: async () => {},
      installDiagnosticPlugin: async () => {},
      runDoctor: async () => ({ status: 'healthy', issueCodes: [], output: '{}' }),
      productionDoctorFixtures: false,
      onSnapshot: () => {},
    })
    const initial = manager.start({
      scenarioIds: ['host-shadow-compatible'],
      target: 'active-profile',
    })
    const final = await waitForTerminal(manager, initial.runId)
    expect(final.phase).toBe('failed')
    expect(final.diagnostic).toContain('token=[REDACTED]')
    expect(final.diagnostic).toContain('$DSH_HOME')
    expect(final.diagnostic).not.toContain('secret-value')
  })

  it('reconnects to an intentionally retained run after desktop restart', async () => {
    const b = await bench()
    const initial = b.manager.start({ scenarioIds: ['orphaned-bundle'], target: 'active-profile' })
    expect((await waitForTerminal(b.manager, initial.runId)).phase).toBe('active')
    const restarted = new DiagnosticLabManager({
      root: join(b.root, 'lab'),
      activeDshHome: b.home,
      logDirectory: join(b.root, 'logs'),
      suspendHarness: b.suspendHarness,
      resumeHarness: b.resumeHarness,
      installProfile: b.installProfile,
      installDiagnosticPlugin: b.installDiagnosticPlugin,
      runDoctor: b.runDoctor,
      productionDoctorFixtures: false,
      onSnapshot: () => {},
    })
    await restarted.recoverPending()
    expect(restarted.current()).toMatchObject({ runId: initial.runId, phase: 'active', recovery: 'retained' })
    await expect(restarted.restoreAll(initial.runId)).resolves.toMatchObject({ phase: 'restored' })
  })

  it('repairs run-specific pnpm residue even when a legacy journal was already marked clean', async () => {
    const b = await bench()
    const initial = b.manager.start({ scenarioIds: ['orphaned-bundle'], target: 'active-profile' })
    expect((await waitForTerminal(b.manager, initial.runId)).phase).toBe('active')
    await b.manager.restoreAll(initial.runId)

    const staleEntry = join(
      b.home,
      'profiles',
      'web',
      'node_modules',
      '.pnpm',
      `@deepseek-ai+dsh-tools@file+diagnostic-fixtures+${initial.runId.slice(0, 20)}_pnpm-truncated`,
    )
    await mkdir(staleEntry, { recursive: true })
    const restarted = new DiagnosticLabManager({
      root: join(b.root, 'lab'),
      activeDshHome: b.home,
      logDirectory: join(b.root, 'logs'),
      suspendHarness: b.suspendHarness,
      resumeHarness: b.resumeHarness,
      installProfile: b.installProfile,
      installDiagnosticPlugin: b.installDiagnosticPlugin,
      runDoctor: b.runDoctor,
      productionDoctorFixtures: false,
      onSnapshot: () => {},
    })

    await restarted.recoverPending()
    expect(existsSync(staleEntry)).toBe(false)
    expect(b.installProfile).toHaveBeenLastCalledWith(b.home, true)
  })
})
