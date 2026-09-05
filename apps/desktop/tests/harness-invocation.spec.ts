import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  DesktopOperationSupervisor,
  HarnessInvocationError,
  runHarnessInvocation,
  windowsTaskkillInvocation,
} from '../src/harness-invocation.ts'

function invocationOptions(timeoutMs = 2_000, signal = new AbortController().signal) {
  return { kind: 'test-command', timeoutMs, signal }
}

describe('desktop one-shot Harness invocation', () => {
  it('returns combined command output for an accepted exit code', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-harness-invocation-'))
    const script = join(root, 'success.cjs')
    writeFileSync(script, "process.stdout.write('snapshot ready')\n")

    await expect(runHarnessInvocation(
      { command: process.execPath, args: [script] },
      invocationOptions(),
    ))
      .resolves.toBe('snapshot ready')
  })

  it('kills and rejects a command that exceeds its startup bound', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-harness-invocation-'))
    const script = join(root, 'blocked.cjs')
    writeFileSync(script, 'setInterval(() => {}, 1_000)\n')

    const startedAt = Date.now()
    const failure = await runHarnessInvocation(
      { command: process.execPath, args: [script] },
      invocationOptions(50),
    ).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(HarnessInvocationError)
    expect(failure).toMatchObject({ timedOut: true })
    expect(Date.now() - startedAt).toBeLessThan(2_000)
  })

  it('bounds retained output while keeping the structured tail', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-harness-invocation-'))
    const script = join(root, 'large-output.cjs')
    writeFileSync(script, "process.stdout.write('x'.repeat(2 * 1024 * 1024) + 'snapshot-tail')\n")

    const output = await runHarnessInvocation(
      { command: process.execPath, args: [script] },
      invocationOptions(),
    )

    expect(Buffer.byteLength(output)).toBe(1024 * 1024)
    expect(output.endsWith('snapshot-tail')).toBe(true)
  })

  it('rejects invalid timeout values before spawning', async () => {
    await expect(runHarnessInvocation(
      { command: process.execPath, args: [] },
      invocationOptions(0),
    ))
      .rejects.toThrow('timeout must be positive')
  })

  it('uses the absolute System32 taskkill command for Windows process trees', () => {
    expect(windowsTaskkillInvocation(123, false, { SystemRoot: 'D:\\Windows' })).toEqual({
      command: join('D:\\Windows', 'System32', 'taskkill.exe'),
      args: ['/PID', '123', '/T'],
    })
    expect(windowsTaskkillInvocation(123, true, { WINDIR: 'C:\\Windows' }).args)
      .toEqual(['/PID', '123', '/T', '/F'])
  })

  it('cancels a running process when its owning signal aborts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-harness-invocation-'))
    const script = join(root, 'cancelled.cjs')
    writeFileSync(script, 'setInterval(() => {}, 1_000)\n')
    const controller = new AbortController()
    const operation = runHarnessInvocation(
      { command: process.execPath, args: [script] },
      invocationOptions(10_000, controller.signal),
    )
    controller.abort()

    await expect(operation).rejects.toMatchObject({ reason: 'cancelled', timedOut: false })
  })

  it.runIf(process.platform !== 'win32')('terminates descendants in the owned POSIX process group', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-harness-process-tree-'))
    const childPidPath = join(root, 'child.pid')
    const script = join(root, 'tree.cjs')
    writeFileSync(script, `
      const { spawn } = require('node:child_process')
      const { writeFileSync } = require('node:fs')
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
      writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid))
      setInterval(() => {}, 1000)
    `)
    const controller = new AbortController()
    const operation = runHarnessInvocation(
      { command: process.execPath, args: [script] },
      invocationOptions(10_000, controller.signal),
    )
    await vi.waitFor(() => { expect(existsSync(childPidPath)).toBe(true) })
    const descendantPid = Number(readFileSync(childPidPath, 'utf8'))
    controller.abort()
    await expect(operation).rejects.toMatchObject({ reason: 'cancelled' })
    await vi.waitFor(() => {
      expect(() => process.kill(descendantPid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
    })
  })

  it('settles all owned operations during desktop disposal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-harness-invocation-'))
    const script = join(root, 'owned.cjs')
    writeFileSync(script, 'setInterval(() => {}, 1_000)\n')
    const supervisor = new DesktopOperationSupervisor()
    const operation = supervisor.run(
      { command: process.execPath, args: [script] },
      { kind: 'owned-test', timeoutMs: 10_000 },
    )
    expect(supervisor.list()).toHaveLength(1)

    await supervisor.dispose()
    await expect(operation).rejects.toMatchObject({ reason: 'cancelled' })
    expect(supervisor.list()).toHaveLength(0)
  })

  it('allows bounded cleanup while disposal rejects ordinary new work', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-harness-invocation-'))
    const blocked = join(root, 'blocked.cjs')
    const cleanup = join(root, 'cleanup.cjs')
    writeFileSync(blocked, 'setInterval(() => {}, 1_000)\n')
    writeFileSync(cleanup, "process.stdout.write('released lock')\n")
    const supervisor = new DesktopOperationSupervisor()
    const active = supervisor.run(
      { command: process.execPath, args: [blocked] },
      { kind: 'active', timeoutMs: 10_000 },
    )
    const disposing = supervisor.dispose()
    const cleanupResult = supervisor.run(
      { command: process.execPath, args: [cleanup] },
      { kind: 'cleanup', timeoutMs: 2_000, allowDuringDisposal: true },
    )

    await expect(active).rejects.toMatchObject({ reason: 'cancelled' })
    await expect(cleanupResult).resolves.toBe('released lock')
    await disposing
    await expect(supervisor.run(
      { command: process.execPath, args: [cleanup] },
      { kind: 'late', timeoutMs: 2_000 },
    )).rejects.toMatchObject({ reason: 'cancelled' })
  })
})
