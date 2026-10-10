import { describe, expect, it } from 'vitest'
import { claimDesktopWebLaunch, waitForDesktopWebRestart } from '../src/desktop-web-launch.ts'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { createServer, connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('Desktop Web restart ownership', () => {
  it('keeps an inherited replacement alive until its Supervisor reports the next ready generation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-delegated-ready-'))
    const home = join(root, 'home')
    const state = join(root, 'restart-state.json')
    const environment: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home,
      DSH_DESKTOP_WEB_RESTART_OWNER: String(process.pid), DSH_DESKTOP_WEB_RESTART_STATE: state }
    environment.DSH_DESKTOP_WEB_OWNER_GENERATION = '1'
    claimDesktopWebLaunch('web', home, environment)
    writeFileSync(state, JSON.stringify({ ownerPid: process.pid, generation: 1, phase: 'ready' }))
    const child = spawn(process.execPath, ['--import', 'tsx/esm', fileURLToPath(new URL('../src/bin.ts', import.meta.url)), 'web'], { env: environment, stdio: 'pipe' })
    const closed = once(child, 'close')
    const server = createServer(socket => socket.end())
    try {
      await new Promise(resolve => setTimeout(resolve, 500))
      // The market helper treats early exit (even code 0) as failure and binds recovery.
      expect(child.exitCode, 'delegation must not trigger premature recovery').toBeNull()
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      writeFileSync(state, JSON.stringify({ ownerPid: process.pid, generation: 2, phase: 'ready' }))
      expect((await closed)[0]).toBe(0)
      // Market checks the live port before checking exited replacement. Its
      // successful owner listener must therefore prevent the recovery branch.
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('missing listener')
      const socket = connect(address.port, '127.0.0.1')
      await once(socket, 'connect')
      socket.destroy()
      expect(existsSync(join(home, 'profiles'))).toBe(false)
    } finally {
      if (child.exitCode === null) child.kill('SIGTERM')
      await closed
      await new Promise<void>(resolve => server.close(() => { resolve() }))
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('settles delegation on explicit owner failure, stop, exit, or a bounded deadline', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-delegated-cancel-'))
    const state = join(root, 'state.json')
    const environment = { DSH_DESKTOP_WEB_RESTART_STATE: state,
      DSH_DESKTOP_WEB_GENERATION: JSON.stringify({ ownerPid: process.pid, home: root, hostPid: process.pid, generation: 1 }) }
    try {
      for (const phase of ['failed', 'stopped']) {
        writeFileSync(state, JSON.stringify({ ownerPid: process.pid, generation: 2, phase }))
        await expect(waitForDesktopWebRestart(environment)).resolves.toBeUndefined()
      }
      writeFileSync(state, JSON.stringify({ ownerPid: process.pid, generation: 1, phase: 'ready' }))
      await expect(waitForDesktopWebRestart(environment, 5)).rejects.toThrow('timed out')
      const exited = spawnSync(process.execPath, ['-e', ''])
      await expect(waitForDesktopWebRestart({ ...environment,
        DSH_DESKTOP_WEB_GENERATION: JSON.stringify({ ownerPid: exited.pid, home: root, hostPid: process.pid, generation: 1 }),
      })).resolves.toBeUndefined()
      writeFileSync(state, JSON.stringify({ ownerPid: process.pid + 1, generation: 2, phase: 'ready' }))
      await expect(waitForDesktopWebRestart(environment)).rejects.toThrow('invalid Desktop restart state')
      await expect(waitForDesktopWebRestart({})).resolves.toBeUndefined()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('stops an inherited replacement at the real CLI entry before initializing a Profile', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-owned-web-'))
    try {
      const home = join(root, 'home')
      const environment: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home, DSH_DESKTOP_WEB_RESTART_OWNER: String(process.pid) }
      expect(claimDesktopWebLaunch('web', home, environment)).toBe(true)
      const result = spawnSync(process.execPath, ['--import', 'tsx/esm', fileURLToPath(new URL('../src/bin.ts', import.meta.url)), 'web'], {
        env: environment, encoding: 'utf8', timeout: 15_000, windowsHide: true,
      })
      expect(result.status, result.stderr).toBe(0)
      expect(result.stderr).toContain('no second service started')
      expect(existsSync(join(home, 'profiles'))).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('admits the Supervisor launch but not an inherited same-Profile replacement', () => {
    const environment: NodeJS.ProcessEnv = { DSH_DESKTOP_WEB_RESTART_OWNER: '123' }
    expect(claimDesktopWebLaunch('web', '/tmp/desktop home', environment)).toBe(true)
    expect(claimDesktopWebLaunch('web', '/tmp/desktop home', { ...environment })).toBe(false)
    expect(claimDesktopWebLaunch('web', '/tmp/desktop home/.', { ...environment })).toBe(false)
    expect(claimDesktopWebLaunch('sdk', '/tmp/desktop home', { ...environment })).toBe(true)
    expect(claimDesktopWebLaunch('web', '/tmp/another home', { ...environment })).toBe(true)
  })

  it('does not alter standalone CLI environments', () => {
    const environment = { DSH_HOME: '/tmp/standalone' }
    expect(claimDesktopWebLaunch('web', environment.DSH_HOME, environment)).toBe(true)
    expect(environment).toEqual({ DSH_HOME: '/tmp/standalone' })
  })

  it('fails closed for invalid inherited ownership', () => {
    expect(() => claimDesktopWebLaunch('web', '/tmp/home', { DSH_DESKTOP_WEB_RESTART_OWNER: 'bad' })).toThrow()
    for (const record of ['{', 'null', '{}', '{"ownerPid":124,"home":"/tmp/home","hostPid":12}']) {
      expect(() => claimDesktopWebLaunch('web', '/tmp/home', {
        DSH_DESKTOP_WEB_RESTART_OWNER: '123', DSH_DESKTOP_WEB_GENERATION: record,
      })).toThrow()
    }
  })
})
