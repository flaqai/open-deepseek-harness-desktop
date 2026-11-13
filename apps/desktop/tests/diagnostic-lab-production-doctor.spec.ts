import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  initProfile,
  inspectProfileDependencies,
  repairProfileDependencies,
  SHARED_HOST_PACKAGES,
} from '../../../packages/boot/app-boot/src/index.ts'
import { DiagnosticLabManager, type DiagnosticLabRunSnapshot } from '../src/diagnostic-lab.ts'

const roots: string[] = []
const stopRuns: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const stop of stopRuns.splice(0)) await stop()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`)
}

async function waitForTerminal(
  manager: DiagnosticLabManager,
  runId: string,
): Promise<DiagnosticLabRunSnapshot> {
  for (let count = 0; count < 400; count += 1) {
    const snapshot = manager.get(runId)
    if (['active', 'failed', 'cancelled'].includes(snapshot.phase)) return snapshot
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('production Doctor exercise did not settle')
}

async function productionBench(): Promise<{
  root: string
  manager: DiagnosticLabManager
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-diagnostic-production-'))
  roots.push(root)
  const activeHome = join(root, 'active-home')
  await writeJson(join(activeHome, 'profiles', 'web', 'package.json'), {
    name: 'dsh-profile-web',
    private: true,
  })

  const appDir = join(root, 'harness')
  const dependencies: Record<string, string> = {}
  for (const packageName of SHARED_HOST_PACKAGES) {
    dependencies[packageName] = '0.1.5-rc.2'
    await writeJson(join(appDir, 'node_modules', packageName, 'package.json'), {
      name: packageName,
      version: '0.1.5-rc.2',
    })
  }
  const installAnchor = join(appDir, 'package.json')
  await writeJson(installAnchor, { name: 'diagnostic-host', version: '0.1.5-rc.2', dependencies })

  const runPackageManager = (home: string, args: readonly string[]) => {
    const profileDir = join(home, 'profiles', 'web')
    const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'CI'))
    environment.PATH = environment.PATH
      ?.split(delimiter)
      .filter(entry => !entry.replaceAll('\\', '/').endsWith('node_modules/.bin'))
      .join(delimiter)
    const child = spawnSync(command, [...args, '--offline', '--ignore-scripts'], {
      cwd: profileDir,
      encoding: 'utf8',
      env: environment,
    })
    return {
      exitCode: child.status,
      diagnostic: `${child.stdout}${child.stderr}`.trim(),
    }
  }

  const ensureProfile = async (home: string): Promise<void> => {
    const profileDir = join(home, 'profiles', 'web')
    if (!existsSync(join(profileDir, 'package.json'))) initProfile(profileDir, [])
    for (const packageName of SHARED_HOST_PACKAGES) {
      const target = join(home, 'profiles', 'node_modules', packageName)
      if (existsSync(target)) continue
      await mkdir(dirname(target), { recursive: true })
      await symlink(join(appDir, 'node_modules', packageName), target, process.platform === 'win32' ? 'junction' : 'dir')
    }
  }

  let settleRun!: () => void
  const settled = new Promise<void>((resolve) => { settleRun = resolve })
  const manager = new DiagnosticLabManager({
    root: join(root, 'lab'),
    activeDshHome: activeHome,
    logDirectory: join(root, 'logs'),
    suspendHarness: async () => {},
    resumeHarness: () => {},
    installProfile: async (home, force) => {
      await ensureProfile(home)
      const result = runPackageManager(home, ['install', ...(force ? ['--force'] : [])])
      if (result.exitCode !== 0) throw new Error(result.diagnostic)
    },
    installDiagnosticPlugin: async () => {},
    runDoctor: async (home, repair) => {
      await ensureProfile(home)
      if (repair) {
        const result = repairProfileDependencies({
          binName: 'diagnostic-test',
          profile: 'web',
          installAnchor,
          home,
          runPackageManager: args => runPackageManager(home, args),
        })
        return {
          status: result.status,
          issueCodes: result.issues?.map(issue => issue.code) ?? [],
          output: JSON.stringify(result),
        }
      }
      const conflicts = inspectProfileDependencies({
        binName: 'diagnostic-test',
        profile: 'web',
        installAnchor,
        home,
      })
      return {
        status: conflicts.length === 0 ? 'healthy' : 'failed',
        issueCodes: conflicts.length === 0 ? [] : ['profile.host-dependency-conflict'],
        output: JSON.stringify({ conflicts }),
      }
    },
    onSnapshot: (snapshot) => {
      if (['active', 'failed', 'cancelled'].includes(snapshot.phase)) settleRun()
    },
  })
  stopRuns.push(async () => {
    const run = manager.current()
    if (run === undefined) return
    manager.cancel(run.runId)
    await settled
  })
  return { root, manager }
}

describe('Diagnostics Lab production Doctor exercises', () => {
  for (const [scenarioId, disposition] of [
    ['host-shadow-compatible', 'repaired'],
    ['host-shadow-incompatible', 'quarantined'],
  ] as const) {
    it(`${scenarioId} reaches the reviewed ${disposition} outcome with real pnpm cleanup`, async () => {
      const { root, manager } = await productionBench()
      const started = manager.start({ scenarioIds: [scenarioId], target: 'isolated' })
      const final = await waitForTerminal(manager, started.runId)

      expect(final.phase, final.diagnostic).toBe('active')
      expect(final.results).toEqual([
        expect.objectContaining({
          scenarioId,
          phase: 'passed',
          disposition,
        }),
      ])
      const profileDir = join(
        root,
        'lab',
        'runs',
        started.runId,
        'runtime',
        'doctor-homes',
        scenarioId,
        'profiles',
        'web',
      )
      const workspace = await readFile(join(profileDir, 'pnpm-workspace.yaml'), 'utf8')
      expect(workspace).not.toContain(`${scenarioId}-shared-host`)
      expect(workspace).not.toContain('nodeLinker: isolated')
      const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
      }
      const packageName = `@dsh-diagnostic-lab/${scenarioId}`
      if (disposition === 'repaired') expect(manifest.dependencies?.[packageName]).toBeDefined()
      else expect(manifest.dependencies?.[packageName]).toBeUndefined()
    })
  }
})
