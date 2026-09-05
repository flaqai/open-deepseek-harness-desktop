import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessSupervisor, type HarnessFailure, type HarnessState } from '../src/supervisor.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Harness supervisor startup failures', () => {
  it('can start directly in diagnostic safe mode when a Profile mutation lock is unsafe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-initial-safe-mode-'))
    roots.push(root)
    const script = join(root, 'initial-safe-mode.mjs')
    await writeFile(script, `
      if (process.env.DSH_PROFILE_SAFE_MODE !== '1') process.exit(19)
      console.log('dsh web: http://127.0.0.1:43129')
      setInterval(() => {}, 1000)
    `)
    let resolveReady: (url: string) => void = () => {}
    const ready = new Promise<string>((resolve) => { resolveReady = resolve })
    const supervisor = new HarnessSupervisor({
      launch: { command: process.execPath, args: [script] },
      logPath: join(root, 'harness.log'),
      environment: { ...process.env },
      initialSafeMode: true,
      initialSafeModeReason: 'Profile mutation lock is busy.',
      onReady: resolveReady,
      onState: () => {},
      onFailure: (failure) => { throw new Error(failure.message) },
    })

    supervisor.start()
    await expect(ready).resolves.toBe('http://127.0.0.1:43129')
    await supervisor.stop()
  }, 10_000)

  it('enters the installation-owned diagnostic profile after one deterministic failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-safe-mode-'))
    roots.push(root)
    const script = join(root, 'safe-mode.mjs')
    const logPath = join(root, 'harness.log')
    await writeFile(script, `
      if (process.env.DSH_PROFILE_SAFE_MODE !== '1') {
        console.error('dsh: profile safe mode eligible {"code":"config.credentials-invalid"}')
        process.exit(17)
      }
      console.log('dsh web: http://127.0.0.1:43124')
      setInterval(() => {}, 1000)
    `)
    const states: HarnessState[] = []
    let resolveReady: (url: string) => void = () => {}
    const ready = new Promise<string>((resolve) => { resolveReady = resolve })
    const supervisor = new HarnessSupervisor({
      launch: { command: process.execPath, args: [script] },
      logPath,
      environment: { ...process.env },
      onReady: resolveReady,
      onState: (state) => { states.push(state) },
      onFailure: (failure) => { throw new Error(failure.message) },
    })
    supervisor.start()
    await expect(ready).resolves.toBe('http://127.0.0.1:43124')
    expect(states).toContain('restarting')
    expect(await readFile(logPath, 'utf8')).toContain('installation-owned diagnostic profile')
    await supervisor.stop()
  }, 10_000)

  it('stops retrying after three exits before readiness', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-failure-'))
    roots.push(root)
    const script = join(root, 'fail.mjs')
    const logPath = join(root, 'harness.log')
    await writeFile(script, 'process.exit(12)\n')
    const states: HarnessState[] = []
    let resolveFailure: (failure: HarnessFailure) => void = () => {}
    const failure = new Promise<HarnessFailure>((resolve) => { resolveFailure = resolve })
    const supervisor = new HarnessSupervisor({
      launch: { command: process.execPath, args: [script] },
      logPath,
      environment: { ...process.env },
      onReady: () => {},
      onState: (state) => { states.push(state) },
      onFailure: resolveFailure,
    })
    supervisor.start()
    await expect(failure).resolves.toEqual({ message: 'Harness exited before becoming ready (code 12, signal null).' })
    expect(states.at(-1)).toBe('failed')
    expect(await readFile(logPath, 'utf8')).toContain('startup failed after 3 attempts')
    await supervisor.stop()
  }, 10_000)

  it('attempts diagnostic safe mode only once and retains the normal failure as primary evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-safe-mode-failure-'))
    roots.push(root)
    const script = join(root, 'fail-safe-mode.mjs')
    const counter = join(root, 'counter.txt')
    const logPath = join(root, 'harness.log')
    await writeFile(script, `
      import { readFileSync, writeFileSync } from 'node:fs'
      const path = process.argv[2]
      let count = 0
      try { count = Number(readFileSync(path, 'utf8')) } catch {}
      writeFileSync(path, String(count + 1))
      if (process.env.DSH_PROFILE_SAFE_MODE !== '1') {
        console.error('dsh: profile safe mode eligible {"code":"profile.module-resolution"}')
        process.exit(21)
      }
      process.exit(22)
    `)
    let resolveFailure: (failure: HarnessFailure) => void = () => {}
    const failure = new Promise<HarnessFailure>((resolve) => { resolveFailure = resolve })
    const supervisor = new HarnessSupervisor({
      launch: { command: process.execPath, args: [script, counter] },
      logPath,
      environment: { ...process.env },
      onReady: () => {},
      onState: () => {},
      onFailure: resolveFailure,
    })

    supervisor.start()
    await expect(failure).resolves.toEqual({
      message: 'Harness exited before becoming ready (code 21, signal null). diagnostic safe mode exited before becoming ready (code 22, signal null).',
    })
    expect(await readFile(counter, 'utf8')).toBe('2')
    expect(await readFile(logPath, 'utf8')).toContain('one normal and one diagnostic attempt')
    await supervisor.stop()
  }, 10_000)

  it('allows an explicit retry after the failure limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-retry-'))
    roots.push(root)
    const script = join(root, 'eventual-ready.mjs')
    const counter = join(root, 'counter.txt')
    await writeFile(script, `
      import { readFileSync, writeFileSync } from 'node:fs'
      const path = process.argv[2]
      let count = 0
      try { count = Number(readFileSync(path, 'utf8')) } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      count += 1
      writeFileSync(path, String(count))
      if (count <= 3) process.exit(14)
      console.log('dsh web: http://127.0.0.1:43123')
      setInterval(() => {}, 1000)
    `)
    let resolveReady: (url: string) => void = () => {}
    const ready = new Promise<string>((resolve) => { resolveReady = resolve })
    const supervisor = new HarnessSupervisor({
      launch: { command: process.execPath, args: [script, counter] },
      logPath: join(root, 'harness.log'),
      environment: { ...process.env },
      onReady: resolveReady,
      onState: () => {},
      onFailure: () => { expect(supervisor.retry()).toBe(true) },
    })
    supervisor.start()
    await expect(ready).resolves.toBe('http://127.0.0.1:43123')
    await supervisor.stop()
  }, 10_000)

  it('stops the Windows Harness process tree gracefully before forcing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-tree-stop-'))
    roots.push(root)
    const script = join(root, 'wait.mjs')
    await writeFile(script, 'setInterval(() => {}, 1000)\n')
    const terminateProcessTree = vi.fn(async (processId: number, force: boolean) => {
      if (force) process.kill(processId, 'SIGKILL')
    })
    const supervisor = new HarnessSupervisor({
      launch: { command: process.execPath, args: [script] },
      logPath: join(root, 'harness.log'),
      environment: { ...process.env },
      onReady: () => {},
      onState: () => {},
      onFailure: () => {},
      terminateProcessTree,
      stopTimeoutMs: 25,
    })

    supervisor.start()
    await supervisor.stop()

    expect(terminateProcessTree.mock.calls.map(([, force]) => force)).toEqual([false, true])
    await supervisor.stop()
    expect(terminateProcessTree).toHaveBeenCalledTimes(2)
  })

  it('resumes once after a deliberate maintenance stop', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-maintenance-'))
    roots.push(root)
    const script = join(root, 'ready.mjs')
    await writeFile(script, `
      console.log('dsh web: http://127.0.0.1:43126')
      setInterval(() => {}, 1000)
    `)
    let readyCount = 0
    let resolveReady: () => void = () => {}
    let ready = new Promise<void>((resolve) => { resolveReady = resolve })
    const supervisor = new HarnessSupervisor({
      launch: { command: process.execPath, args: [script] },
      logPath: join(root, 'harness.log'),
      environment: { ...process.env },
      onReady: () => { readyCount += 1; resolveReady() },
      onState: () => {},
      onFailure: (failure) => { throw new Error(failure.message) },
    })

    supervisor.start()
    await ready
    await supervisor.stop()
    ready = new Promise<void>((resolve) => { resolveReady = resolve })
    expect(supervisor.resume()).toBe(true)
    await ready
    expect(readyCount).toBe(2)
    expect(supervisor.resume()).toBe(false)
    await supervisor.stop()
  }, 10_000)
})
