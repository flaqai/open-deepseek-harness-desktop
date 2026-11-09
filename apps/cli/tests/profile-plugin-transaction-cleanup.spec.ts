import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { prepareProfilePluginTransaction, settleProfilePluginTransaction, readProfilePluginTransaction, retrySettledProfilePluginCleanup } from '../src/profile-plugin-transaction.ts'

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return { ...original, rmSync: vi.fn(original.rmSync) }
})

it('defers only inert candidate deletion after rollback without retaining an active transaction', async () => {
  const original = await vi.importActual<typeof import('node:fs')>('node:fs')
  const home = mkdtempSync(join(tmpdir(), 'transaction-cleanup-'))
  try {
    mkdirSync(join(home, 'profiles/web/node_modules'), { recursive: true })
    writeFileSync(join(home, 'profiles/web/package.json'), '{}')
    writeFileSync(join(home, 'profiles/web/pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    writeFileSync(join(home, 'profiles/web/node_modules/sentinel'), 'untouched')
    const tx = prepareProfilePluginTransaction(home, 'web')
    const owned = join(home, 'plugin-transactions/web', tx.id)
    vi.mocked(rmSync).mockImplementation((path, options) => {
      if (String(path) === owned) throw Object.assign(new Error('candidate locked'), { code: 'EBUSY' })
      original.rmSync(path, options)
    })
    expect(settleProfilePluginTransaction(home, 'web', tx.id, false)).toEqual({ cleanupDeferred: true })
    expect(readProfilePluginTransaction(home, 'web')).toBeUndefined()
    expect(readFileSync(join(home, 'profiles/web/node_modules/sentinel'), 'utf8')).toBe('untouched')
    const receipt = join(home, 'plugin-transactions/web/cleanup-pending', tx.id + '.json')
    expect(existsSync(receipt)).toBe(true)
    const originalReceipt: unknown = JSON.parse(readFileSync(receipt, 'utf8'))
    expect(originalReceipt).toMatchObject({ id: tx.id })
    vi.mocked(rmSync).mockImplementation(original.rmSync)
    expect(retrySettledProfilePluginCleanup(home, 'web')).toBe(0)
    const record: unknown = JSON.parse(readFileSync(receipt, 'utf8'))
    if (record === null || typeof record !== 'object') throw new Error('invalid test receipt')
    writeFileSync(receipt, JSON.stringify({ ...record, producerPid: 99999999 }))
    expect(retrySettledProfilePluginCleanup(home, 'web')).toBe(1)
    expect(existsSync(owned)).toBe(false)
    expect(existsSync(receipt)).toBe(false)
  } finally { vi.mocked(rmSync).mockImplementation(original.rmSync); original.rmSync(home, { recursive: true, force: true }) }
})
