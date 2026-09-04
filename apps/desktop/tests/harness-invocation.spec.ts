import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HarnessInvocationError, runHarnessInvocation } from '../src/harness-invocation.ts'

describe('desktop one-shot Harness invocation', () => {
  it('returns combined command output for an accepted exit code', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-harness-invocation-'))
    const script = join(root, 'success.cjs')
    writeFileSync(script, "process.stdout.write('snapshot ready')\n")

    await expect(runHarnessInvocation({ command: process.execPath, args: [script] }))
      .resolves.toBe('snapshot ready')
  })

  it('kills and rejects a command that exceeds its startup bound', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-harness-invocation-'))
    const script = join(root, 'blocked.cjs')
    writeFileSync(script, 'setInterval(() => {}, 1_000)\n')

    const startedAt = Date.now()
    const failure = await runHarnessInvocation(
      { command: process.execPath, args: [script] },
      [0],
      50,
    ).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(HarnessInvocationError)
    expect(failure).toMatchObject({ timedOut: true })
    expect(Date.now() - startedAt).toBeLessThan(2_000)
  })

  it('bounds retained output while keeping the structured tail', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-harness-invocation-'))
    const script = join(root, 'large-output.cjs')
    writeFileSync(script, "process.stdout.write('x'.repeat(2 * 1024 * 1024) + 'snapshot-tail')\n")

    const output = await runHarnessInvocation({ command: process.execPath, args: [script] })

    expect(Buffer.byteLength(output)).toBe(1024 * 1024)
    expect(output.endsWith('snapshot-tail')).toBe(true)
  })

  it('rejects invalid timeout values before spawning', async () => {
    await expect(runHarnessInvocation({ command: process.execPath, args: [] }, [0], 0))
      .rejects.toThrow('timeout must be positive')
  })
})
