import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessSupervisor, type HarnessFailure, type HarnessState } from '../src/supervisor.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Harness supervisor startup failures', () => {
  it('terminates surviving owned range members after direct exit before awaiting restart admission', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-surviving-range-'))
    roots.push(root)
    const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const events: string[] = []
    const inspection = Promise.withResolvers<undefined>()
    const terminate = vi.fn(() => { events.push('terminate') })
    const waitForExit = vi.fn(async () => {
      events.push('idle')
      if (!terminate.mock.calls.length) throw new Error('surviving helper cannot exit until owner takes over')
      return true
    })
    const supervisor = new HarnessSupervisor({
      launch: { command: 'node', args: [] }, environment: {}, logPath: join(root, 'harness.log'),
      onReady: () => {}, onDiagnosticReady: () => {}, onState: () => {}, onFailure: inspection.reject,
      beforeRestart: async () => { events.push('inspect'); inspection.resolve(undefined) },
      managedRuntime: { register: () => 'owner', preserve: async () => {}, stopAll: async () => {},
        stop: async () => {}, stopRecovered: async () => {}, list: () => [],
        launch: () => ({ containment: 'linux-scope', handle: {
          stdin: undefined, stdout, stderr, done: done.promise, waitForExit, terminate,
        } }),
      },
    })
    try {
      supervisor.start()
      stdout.write('dsh web: http://127.0.0.1:43129\n')
      done.resolve({ exitCode: 0, signal: null })
      await inspection.promise
      expect(events).toEqual(['terminate', 'idle', 'inspect'])
    } finally { terminate(); await supervisor.stop(); stdout.destroy(); stderr.destroy() }
  })

  it.each(['process-group', 'windows-job', 'linux-scope'])('keeps restart admission fenced until the old managed range is idle (%s)', async (containment) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-range-admission-'))
    roots.push(root)
    const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
    const range = Promise.withResolvers<boolean>()
    const observed = Promise.withResolvers<undefined>()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const launch = vi.fn(() => ({ containment, handle: {
      stdin: undefined, stdout, stderr, done: done.promise,
      waitForExit: async () => { observed.resolve(undefined); return range.promise }, terminate: vi.fn(),
    } }))
    const inspection = vi.fn(async () => {})
    const supervisor = new HarnessSupervisor({
      launch: { command: 'node', args: [] }, environment: {}, logPath: join(root, 'harness.log'),
      onReady: () => {}, onDiagnosticReady: () => {}, onState: () => {}, onFailure: () => {},
      beforeRestart: inspection,
      managedRuntime: { register: () => 'owner', preserve: async () => {}, stopAll: async () => {},
        stop: async () => {}, stopRecovered: async () => {}, list: () => [], launch },
    })
    try {
      supervisor.start()
      stdout.write('dsh web: http://127.0.0.1:43129\n')
      done.resolve({ exitCode: 0, signal: null })
      await observed.promise
      expect(launch).toHaveBeenCalledTimes(1)
      expect(inspection).not.toHaveBeenCalled()
      const stopping = supervisor.stop()
      range.resolve(true)
      await stopping
      await new Promise(resolve => setTimeout(resolve, 550))
      expect(launch).toHaveBeenCalledTimes(1)
      expect(inspection).not.toHaveBeenCalled()
    } finally { range.resolve(true); await supervisor.stop(); stdout.destroy(); stderr.destroy() }
  })

  it('publishes terminal failure instead of starting a competing service when managed range remains active', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-active-range-'))
    roots.push(root)
    const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
    const reported = Promise.withResolvers<HarnessFailure>()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const waitForExit = vi.fn().mockResolvedValue(false)
    const launch = vi.fn(() => ({ containment: 'linux-scope', handle: {
      stdin: undefined, stdout, stderr, done: done.promise, waitForExit, terminate: vi.fn(),
    } }))
    const supervisor = new HarnessSupervisor({
      launch: { command: 'node', args: [] }, environment: {}, logPath: join(root, 'harness.log'),
      onReady: () => {}, onDiagnosticReady: () => {}, onState: () => {}, onFailure: reported.resolve,
      managedRuntime: { register: () => 'owner', preserve: async () => {}, stopAll: async () => {},
        stop: async () => {}, stopRecovered: async () => {}, list: () => [], launch },
    })
    try {
      supervisor.start()
      stdout.write('dsh web: http://127.0.0.1:43129\n')
      done.resolve({ exitCode: 0, signal: null })
      expect((await reported.promise).message).toContain('process range did not become idle')
      expect(launch).toHaveBeenCalledTimes(1)
      const directory = (await readdir(root)).find(name => name.startsWith('.desktop-web-restart-'))!
      const state: unknown = JSON.parse(await readFile(join(root, directory, 'state.json'), 'utf8'))
      expect(state).toMatchObject({ phase: 'failed' })
    } finally { waitForExit.mockResolvedValue(true); await supervisor.stop(); stdout.destroy(); stderr.destroy() }
  })

  it.each([['--port', '0'], ['--port=0'], ['--port', '1234', '--port', '0']])('reuses the actual listener port after a normal port-zero generation exits (%j)', async (...args) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-stable-origin-'))
    roots.push(root)
    const script = join(root, 'listen.mjs')
    await writeFile(script, `
      import { createServer } from 'node:http'
      import { existsSync, writeFileSync } from 'node:fs'
      const first = !existsSync(${JSON.stringify(join(root, 'started'))})
      writeFileSync(${JSON.stringify(join(root, 'started'))}, '1')
      let port
      for (let i = 0; i < process.argv.length; i++) {
        if (process.argv[i] === '--port') port = process.argv[i + 1]
        else if (process.argv[i].startsWith('--port=')) port = process.argv[i].slice(7)
      }
      writeFileSync(${JSON.stringify(join(root, 'requested-port'))}, port)
      writeFileSync(${JSON.stringify(join(root, 'current-home'))}, process.env.DSH_HOME)
      const server = createServer((req, res) => res.end('ready'))
      server.listen(Number(port), '127.0.0.1', () => {
        console.log('dsh web: http://127.0.0.1:' + server.address().port)
        if (first) setTimeout(() => process.exit(0), 250)
      })
    `)
    const urls: string[] = []
    const ready = Promise.withResolvers<undefined>()
    const environment = { ...process.env, DSH_HOME: join(root, 'first home') }
    const supervisor = new HarnessSupervisor({ launch: { command: process.execPath, args: [script, ...args] },
      environment, logPath: join(root, 'harness.log'),
      onReady: (url) => { urls.push(url); if (urls.length >= 2) ready.resolve(undefined) },
      onDiagnosticReady: () => {}, onState: () => {}, onFailure: ready.reject })
    try {
      supervisor.start()
      await ready.promise
      expect(new URL(urls[1]!).port).toBe(new URL(urls[0]!).port)
      expect(await readFile(join(root, 'requested-port'), 'utf8')).toBe(new URL(urls[0]!).port)
      await supervisor.stop()
      environment.DSH_HOME = join(root, 'second home')
      expect(supervisor.resume()).toBe(true)
      const until = Date.now() + 5000
      while (urls.length < 3 && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25))
      expect(urls).toHaveLength(3)
      expect(await readFile(join(root, 'requested-port'), 'utf8')).toBe('0')
      expect(await readFile(join(root, 'current-home'), 'utf8')).toBe(environment.DSH_HOME)
    } finally { await supervisor.stop() }
  })
  it('retains an explicit final port flag even when an earlier duplicate requests zero', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-explicit-port-'))
    roots.push(root)
    const script = join(root, 'explicit.mjs')
    await writeFile(script, `
      import { existsSync, writeFileSync } from 'node:fs'
      const first = !existsSync(${JSON.stringify(join(root, 'args'))})
      writeFileSync(${JSON.stringify(join(root, 'args'))}, JSON.stringify(process.argv.slice(2)))
      console.log('dsh web: http://127.0.0.1:55000')
      if (first) setTimeout(() => process.exit(0), 100)
      else setInterval(() => {}, 1000)
    `)
    let generations = 0
    const ready = Promise.withResolvers<undefined>()
    const args = ['--port', '0', '--port', '44444']
    const supervisor = new HarnessSupervisor({ launch: { command: process.execPath, args: [script, ...args] },
      environment: { ...process.env }, logPath: join(root, 'harness.log'),
      onReady: () => { if (++generations === 2) ready.resolve(undefined) },
      onDiagnosticReady: () => {}, onState: () => {}, onFailure: ready.reject })
    try {
      supervisor.start()
      await ready.promise
      expect(JSON.parse(await readFile(join(root, 'args'), 'utf8'))).toEqual(args)
    } finally { await supervisor.stop() }
  })
  it.skipIf(process.platform === 'win32').each(['ownership', 'rename'])('stops the owned child even when restart state IO fails (%s)', async (failure) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-state-failure-'))
    roots.push(root)
    const ready = Promise.withResolvers<undefined>()
    let pid: number | undefined
    const supervisor = new HarnessSupervisor({ launch: { command: process.execPath, args: ['-e', "console.log('dsh web: http://127.0.0.1:43129'); setInterval(() => {}, 1000)"] },
      environment: { ...process.env }, logPath: join(root, 'harness.log'), onSpawn: (value) => { pid = value },
      onReady: () => { ready.resolve(undefined) }, onDiagnosticReady: () => {}, onState: () => {}, onFailure: ready.reject })
    const directory = join(root, (await readdir(root)).find(name => name.startsWith('.desktop-web-restart-'))!)
    try {
      supervisor.start()
      await ready.promise
      if (failure === 'ownership') await chmod(directory, 0o755)
      else { await rm(join(directory, 'state.json')); await mkdir(join(directory, 'state.json')) }
      await expect(supervisor.stop()).rejects.toThrow()
      expect(() => process.kill(pid!, 0)).toThrow()
      expect(await readdir(directory)).not.toContain('state.json.tmp')
    } finally {
      await chmod(directory, 0o700)
      if (failure === 'rename') await rm(join(directory, 'state.json'), { recursive: true })
      await supervisor.stop()
    }
  })
  it.skipIf(process.platform === 'win32')('refuses startup before spawning if restart state ownership is invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-refuse-state-'))
    roots.push(root)
    const failure = Promise.withResolvers<HarnessFailure>()
    const spawned = vi.fn()
    const supervisor = new HarnessSupervisor({ launch: { command: process.execPath, args: [] },
      environment: { ...process.env }, logPath: join(root, 'harness.log'), onSpawn: spawned,
      onReady: () => {}, onDiagnosticReady: () => {}, onState: () => {}, onFailure: failure.resolve })
    const directory = join(root, (await readdir(root)).find(name => name.startsWith('.desktop-web-restart-'))!)
    try {
      await chmod(directory, 0o755)
      supervisor.start()
      expect((await failure.promise).message).toContain('restart coordination could not start')
      expect(spawned).not.toHaveBeenCalled()
    } finally { await chmod(directory, 0o700); await supervisor.stop() }
  })
  it('contains a Windows Job range failure while stopping instead of retrying termination', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-stop-owner-failure-'))
    roots.push(root)
    const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
    const rangeFailure = new Error('Windows Job runner exited with exit code 1073807364 before proving its managed range empty')
    const terminate = vi.fn()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const supervisor = new HarnessSupervisor({
      launch: { command: 'node', args: [] }, environment: {}, logPath: join(root, 'harness.log'),
      onReady: () => {}, onDiagnosticReady: () => {}, onState: () => {}, onFailure: () => {},
      stopTimeoutMs: 25,
      managedRuntime: {
        register: () => 'owner', preserve: async () => {}, stopAll: async () => {}, stop: async () => {},
        stopRecovered: async () => {}, list: () => [],
        launch: () => ({ containment: 'windows-job', handle: {
          stdin: undefined, stdout, stderr, done: done.promise,
          waitForExit: async () => { throw rangeFailure }, terminate,
        } }),
      },
    })
    try {
      supervisor.start()
      const stopping = supervisor.stop()
      done.resolve({ exitCode: 0, signal: null })
      await expect(stopping).rejects.toBe(rangeFailure)
      expect(terminate).toHaveBeenCalledTimes(1)
    } finally {
      stdout.destroy()
      stderr.destroy()
    }
  })

  it.each([true, false])('reports rejected range observation without losing the original failure (direct rejection: %s)', async (directRejected) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-owner-failure-'))
    roots.push(root)
    const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
    const reported = Promise.withResolvers<HarnessFailure>()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const waitForExit = vi.fn().mockRejectedValue(new Error('range observation failed'))
    const terminate = vi.fn()
    const supervisor = new HarnessSupervisor({
      launch: { command: 'node', args: [] }, environment: {}, logPath: join(root, 'harness.log'),
      onReady: () => {}, onDiagnosticReady: () => {}, onState: () => {}, onFailure: reported.resolve,
      stopTimeoutMs: 1,
      managedRuntime: {
        register: () => 'owner', preserve: async () => {}, stopAll: async () => {}, stop: async () => {},
        stopRecovered: async () => {}, list: () => [],
        launch: () => ({ containment: 'windows-job', handle: {
          stdin: undefined, stdout, stderr, done: done.promise, waitForExit, terminate,
        } }),
      },
    })
    try {
      supervisor.start()
      if (directRejected) done.reject(new Error('invalid Windows start request'))
      else done.resolve({ exitCode: 0, signal: null })
      const failure = await reported.promise
      expect(failure.message).toContain('cleanup observation failed: range observation failed')
      if (directRejected) expect(failure.message).toContain('invalid Windows start request')
      expect(await readFile(join(root, 'harness.log'), 'utf8')).toContain(failure.message)
    } finally {
      waitForExit.mockResolvedValue(true)
      await supervisor.stop()
      stdout.destroy()
      stderr.destroy()
    }
    expect(terminate).toHaveBeenCalled()
  })

  it('does not delegate Desktop transaction authority to resident plugin children', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-resident-env-'))
    roots.push(root)
    const script = join(root, 'resident.mjs')
    await writeFile(script, `
      import { execFileSync } from 'node:child_process'
      const keys = Object.keys(process.env).filter(k => /DSH_(DESKTOP_MUTATION|PLUGIN_SNAPSHOT|PLUGIN_TRANSACTION)/i.test(k))
      if (keys.length) throw new Error(keys.join(','))
      if (process.env.DSH_DESKTOP_WEB_GENERATION) throw new Error('inherited a previous Web generation')
      if (process.env.DSH_DESKTOP_WEB_RESTART_OWNER !== ${JSON.stringify(String(process.pid))}) throw new Error('wrong supervisor owner')
      execFileSync(process.execPath, ['-e', 'if (process.env.DSH_DESKTOP_MUTATION_OWNER_PID) process.exit(9)'])
      console.log('dsh web: http://127.0.0.1:43129')
      setInterval(() => {}, 1000)
    `)
    const ready = Promise.withResolvers<string>()
    const supervisor = new HarnessSupervisor({
      launch: { command: process.execPath, args: [script], environment: {
        DSH_PLUGIN_SNAPSHOT_BATCH: '1', DSH_DESKTOP_WEB_GENERATION: 'stale', DSH_DESKTOP_WEB_RESTART_OWNER: '123',
      } },
      environment: { ...process.env, DSH_DESKTOP_MUTATION_OWNER_PID: String(process.pid),
        DSH_PLUGIN_TRANSACTION_ORIGIN: root, DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN: 'private',
        DSH_PLUGIN_SNAPSHOT_LEASE_OWNER_PID: String(process.pid) },
      logPath: join(root, 'harness.log'), onReady: ready.resolve, onDiagnosticReady: () => {},
      onState: () => {}, onFailure: ready.reject,
    })
    try { supervisor.start(); await ready.promise } finally { await supervisor.stop() }
  })

  it('cancels pending restart inspection on stop and ignores its late completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-restart-wait-'))
    roots.push(root)
    const script = join(root, 'exit.mjs')
    await writeFile(script, 'process.exit(1)')
    const checking = Promise.withResolvers<AbortSignal>()
    const completion = Promise.withResolvers<undefined>()
    const failure = vi.fn()
    const supervisor = new HarnessSupervisor({
      launch: { command: process.execPath, args: [script] }, environment: { ...process.env },
      logPath: join(root, 'harness.log'), onReady: () => {}, onDiagnosticReady: () => {},
      onState: () => {}, onFailure: failure,
      beforeRestart: (signal) => { checking.resolve(signal); return completion.promise },
    })
    try {
      supervisor.start()
      const signal = await checking.promise
      await supervisor.stop()
      expect(signal.aborted).toBe(true)
      completion.resolve(undefined)
      await new Promise(resolve => setTimeout(resolve, 600))
      expect(failure).not.toHaveBeenCalled()
      expect((await readFile(join(root, 'harness.log'), 'utf8')).match(/Harness exited/gu)).toHaveLength(1)
    } finally { await supervisor.stop() }
  })

  it('can open Diagnostics directly when a Profile mutation lock is unsafe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-initial-diagnostic-mode-'))
    roots.push(root)
    const script = join(root, 'initial-diagnostic-mode.mjs')
    await writeFile(script, `
      if (process.env.DSH_PROFILE_DIAGNOSTIC_MODE !== '1') process.exit(19)
      console.log('dsh web: http://127.0.0.1:43129')
      setInterval(() => {}, 1000)
    `)
    let resolveReady: (url: string) => void = () => {}
    const ready = new Promise<string>((resolve) => { resolveReady = resolve })
    const states: HarnessState[] = []
    const supervisor = new HarnessSupervisor({
      launch: { command: process.execPath, args: [script] },
      logPath: join(root, 'harness.log'),
      environment: { ...process.env },
      initialDiagnosticMode: true,
      initialDiagnosticReason: 'Profile mutation lock is busy.',
      onReady: () => { throw new Error('diagnostic mode must not open the Harness UI') },
      onDiagnosticReady: resolveReady,
      onState: (state) => { states.push(state) },
      onFailure: (failure) => { throw new Error(failure.message) },
    })

    supervisor.start()
    await expect(ready).resolves.toBe('http://127.0.0.1:43129')
    expect(supervisor.isDiagnosticMode).toBe(true)
    expect(states).not.toContain('ready')
    expect(states.at(-1)).toBe('failed')
    await supervisor.stop()
  }, 10_000)

  it('opens Diagnostics instead of the Harness UI after one deterministic failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-diagnostic-mode-'))
    roots.push(root)
    const script = join(root, 'diagnostic-mode.mjs')
    const logPath = join(root, 'harness.log')
    await writeFile(script, `
      if (process.env.DSH_PROFILE_DIAGNOSTIC_MODE !== '1') {
        console.error('dsh: profile diagnostic mode eligible {"code":"config.credentials-invalid"}')
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
      onReady: () => { throw new Error('diagnostic mode must not open the Harness UI') },
      onDiagnosticReady: resolveReady,
      onState: (state) => { states.push(state) },
      onFailure: (failure) => { throw new Error(failure.message) },
    })
    supervisor.start()
    await expect(ready).resolves.toBe('http://127.0.0.1:43124')
    expect(supervisor.isDiagnosticMode).toBe(true)
    expect(states).not.toContain('ready')
    expect(states.at(-1)).toBe('failed')
    expect(await readFile(logPath, 'utf8')).toContain('Opening Diagnostics')
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
      onDiagnosticReady: () => {},
      onState: (state) => { states.push(state) },
      onFailure: resolveFailure,
    })
    supervisor.start()
    await expect(failure).resolves.toEqual({ message: 'Harness exited before becoming ready (code 12, signal null).' })
    expect(states.at(-1)).toBe('failed')
    expect(await readFile(logPath, 'utf8')).toContain('startup failed after 3 attempts')
    await supervisor.stop()
  }, 10_000)

  it('attempts diagnostic mode only once and retains the normal failure as primary evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-diagnostic-mode-failure-'))
    roots.push(root)
    const script = join(root, 'fail-diagnostic-mode.mjs')
    const counter = join(root, 'counter.txt')
    const logPath = join(root, 'harness.log')
    await writeFile(script, `
      import { readFileSync, writeFileSync } from 'node:fs'
      const path = process.argv[2]
      let count = 0
      try { count = Number(readFileSync(path, 'utf8')) } catch {}
      writeFileSync(path, String(count + 1))
      if (process.env.DSH_PROFILE_DIAGNOSTIC_MODE !== '1') {
        console.error('dsh: profile diagnostic mode eligible {"code":"profile.module-resolution"}')
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
      onDiagnosticReady: () => {},
      onState: () => {},
      onFailure: resolveFailure,
    })

    supervisor.start()
    await expect(failure).resolves.toEqual({
      message: 'Harness exited before becoming ready (code 21, signal null). diagnostic mode exited before becoming ready (code 22, signal null).',
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
      onDiagnosticReady: () => {},
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
      onDiagnosticReady: () => {},
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
      onDiagnosticReady: () => {},
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
