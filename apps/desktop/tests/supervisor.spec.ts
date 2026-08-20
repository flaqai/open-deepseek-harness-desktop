import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HarnessSupervisor, type HarnessFailure, type HarnessState } from '../src/supervisor.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Harness supervisor startup failures', () => {
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
})
