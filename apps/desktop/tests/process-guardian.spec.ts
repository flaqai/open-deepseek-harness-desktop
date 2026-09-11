import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROCESS_GUARDIAN_SOURCE, readProcessRecoveryJournal } from '../src/process-observer.ts'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function fixture(persistentIdentities: readonly { pid: number; started: string }[] = []) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-process-guardian-'))
  directories.push(directory)
  const marker = join(directory, 'stopped')
  const recovery = join(directory, 'recovery.json')
  const persistent = join(directory, 'persistent.runtime')
  const module = join(directory, 'observer.mjs')
  writeFileSync(recovery, JSON.stringify({ marker }))
  if (persistentIdentities.length > 0) writeFileSync(persistent, JSON.stringify({
    schema: 'open-dsh-desktop/persistent-service-runtime/v1',
    records: [{ identities: persistentIdentities }],
  }))
  writeFileSync(module, `
    import { writeFileSync } from 'node:fs'
    export class DesktopProcessObserver {
      restoreRecoveryJournal(value) { this.marker = value.marker }
      excludeIdentities(identities) { this.excluded = identities }
      async stopAll() { writeFileSync(this.marker, JSON.stringify(this.excluded || [])) }
    }
  `)
  const child = spawn(process.execPath, ['-e', PROCESS_GUARDIAN_SOURCE, module, recovery, persistent], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  const ready = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.on('message', (message) => {
      if (message !== null && typeof message === 'object' && (message as { type?: unknown }).type === 'ready') resolve()
    })
  })
  const exited = new Promise<number | null>((resolve) => { child.once('exit', resolve) })
  return { child, ready, exited, marker, recovery }
}

describe('desktop crash process guardian', () => {
  it('runs identity recovery when the Desktop control channel disappears', async () => {
    const b = fixture()
    await b.ready
    b.child.disconnect()
    expect(await b.exited).toBe(0)
    expect(existsSync(b.marker)).toBe(true)
    expect(JSON.parse(readFileSync(b.marker, 'utf8'))).toEqual([])
    expect(existsSync(b.recovery)).toBe(false)
  })

  it('preserves authorized persistent identities during crash recovery', async () => {
    const identities = [{ pid: 4321, started: 'fixture-start' }]
    const b = fixture(identities)
    await b.ready
    b.child.disconnect()
    expect(await b.exited).toBe(0)
    expect(JSON.parse(readFileSync(b.marker, 'utf8'))).toEqual(identities)
  })

  it('does not recover after an explicit clean shutdown', async () => {
    const b = fixture()
    await b.ready
    b.child.send({ type: 'clean' })
    expect(await b.exited).toBe(0)
    expect(existsSync(b.marker)).toBe(false)
    expect(existsSync(b.recovery)).toBe(true)
  })

  it('accepts a BOM-prefixed current recovery journal', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-process-recovery-read-'))
    directories.push(directory)
    const recovery = join(directory, 'recovery-v1.json')
    const document = { schema: 'open-dsh-desktop/process-recovery/v2', records: [] }
    writeFileSync(recovery, `\uFEFF${JSON.stringify(document)}`)
    await expect(readProcessRecoveryJournal(recovery)).resolves.toEqual(document)
    expect(existsSync(`${recovery}.rejected`)).toBe(false)
  })

  it.each([
    ['unreadable', '{'],
    ['legacy', JSON.stringify({ schema: 'open-dsh-desktop/process-recovery/v1', records: [] })],
    ['invalid current', JSON.stringify({
      schema: 'open-dsh-desktop/process-recovery/v2',
      records: [{ id: 'old', label: 'Harness', identities: [] }],
    })],
  ])('quarantines %s derived recovery state instead of blocking startup', async (_kind, source) => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-process-recovery-read-'))
    directories.push(directory)
    const recovery = join(directory, 'recovery-v1.json')
    writeFileSync(recovery, source)
    await expect(readProcessRecoveryJournal(recovery)).resolves.toBeUndefined()
    expect(existsSync(recovery)).toBe(false)
    expect(readFileSync(`${recovery}.rejected`, 'utf8')).toBe(source)
  })
})
