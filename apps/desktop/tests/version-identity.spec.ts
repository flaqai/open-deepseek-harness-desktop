/** Development Electron identity must not replace product versions. */
import { describe, expect, it } from 'vitest'
import { desktopVersionIdentity } from '../src/version-identity.ts'

describe('desktopVersionIdentity', () => {
  const metadata = { version: '0.2.0-rc.2', desktopVersion: '0.2.0-rc.2.1' }
  it('uses build product versions in development instead of Electron', () => {
    expect(desktopVersionIdentity(metadata, false, '44.0.0')).toEqual({
      desktopVersion: '0.2.0-rc.2.1', harnessVersion: '0.2.0-rc.2',
    })
  })
  it('retains installed application identity and embedded core identity', () => {
    expect(desktopVersionIdentity(metadata, true, '0.2.0-rc.2.2')).toEqual({
      desktopVersion: '0.2.0-rc.2.2', harnessVersion: '0.2.0-rc.2',
    })
  })
  it.each([null, {}, { version: '' }, { version: '0.2.0', desktopVersion: 44 }])('rejects incomplete metadata %j', (value) => {
    expect(() => desktopVersionIdentity(value, false, '44.0.0')).toThrow(/rebuild/)
  })
})
