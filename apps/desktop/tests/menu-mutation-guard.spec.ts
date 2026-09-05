import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectProfileMutationLock, menuMutationActive } from '../src/menu-mutation-guard.ts'
const homes: string[] = []
afterEach(() => { vi.restoreAllMocks(); for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })
function home() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-menu-lock-'))
  homes.push(root)
  const directory = join(root, 'plugin-snapshots', 'v1')
  mkdirSync(directory, { recursive: true })
  return { root, lock: join(directory, '.profile-plugin-mutation.web.lock') }
}
describe('read-only plugin mutation guard', () => {
  it('allows a missing lease but blocks live and malformed leases', () => {
    const b = home()
    expect(menuMutationActive(b.root)).toBe(false)
    writeFileSync(b.lock, JSON.stringify({ pid: process.pid }))
    expect(menuMutationActive(b.root)).toBe(true)
    expect(inspectProfileMutationLock(b.root)).toMatchObject({ active: true, state: 'live', pid: process.pid })
    writeFileSync(b.lock, '{')
    expect(menuMutationActive(b.root)).toBe(true)
    expect(inspectProfileMutationLock(b.root)).toMatchObject({ active: true, state: 'malformed' })
  })
  it('allows a proven dead owner but fails closed on permission errors', () => {
    const b = home()
    writeFileSync(b.lock, JSON.stringify({ pid: 99999999 }))
    const probe = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('dead'), { code: 'ESRCH' }) })
    expect(menuMutationActive(b.root)).toBe(false)
    expect(inspectProfileMutationLock(b.root)).toMatchObject({ active: false, state: 'dead', pid: 99999999 })
    probe.mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) })
    expect(menuMutationActive(b.root)).toBe(true)
  })
})
