import { describe, expect, it, vi } from 'vitest'
import { runRecoverySourceRepair } from '../src/recovery-source-repair.ts'

describe('recovery source repair review', () => {
  const selected = { packageName: 'market', version: '2.0.0' }
  const targets = [selected, { packageName: 'im', version: '3.0.0' }]
  it('blocks mutation and confirmation when any missing source cannot use a bundled target', async () => {
    const confirm = vi.fn(() => true)
    const repair = vi.fn(async () => {})
    await expect(runRecoverySourceRepair(selected, {
      getPlan: async () => ({ targets, blocked: [{ packageName: 'custom-plugin' }] }), confirm, repair,
    })).resolves.toEqual({ state: 'blocked', packages: ['custom-plugin'] })
    expect(confirm).not.toHaveBeenCalled()
    expect(repair).not.toHaveBeenCalled()
  })
  it('reviews and passes the complete exact target set to one mutation', async () => {
    const confirm = vi.fn(() => true)
    const repair = vi.fn(async () => {})
    await expect(runRecoverySourceRepair(selected, {
      getPlan: async () => ({ targets, blocked: [] }), confirm, repair,
    })).resolves.toEqual({ state: 'prepared' })
    expect(confirm).toHaveBeenCalledWith(targets)
    expect(repair).toHaveBeenCalledExactlyOnceWith(selected, targets)
  })
  it('cancels without mutation and rejects an outdated selected version', async () => {
    const repair = vi.fn(async () => {})
    const getPlan = async () => ({ targets, blocked: [] })
    await expect(runRecoverySourceRepair(selected, { getPlan, confirm: () => false, repair })).resolves.toEqual({ state: 'cancelled' })
    await expect(runRecoverySourceRepair({ ...selected, version: '1.0.0' }, { getPlan, confirm: () => true, repair })).rejects.toThrow('changed')
    expect(repair).not.toHaveBeenCalled()
  })
})
