/** NAS-only LAN authority sampling alongside explicit invocation trust. */
import { describe, expect, it, vi } from 'vitest'
import { resolveLanTrust, type Config } from '../src/index.ts'

vi.mock('node:os', () => ({
  networkInterfaces: () => ({
    lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    en0: [
      { family: 'IPv6', internal: false, address: 'fe80::1' },
      { family: 'IPv4', internal: false, address: '192.168.1.5' },
    ],
    en1: [{ family: 'IPv4', internal: false, address: '10.0.0.7' }],
    utun0: undefined,
  }),
}))

const nas: NonNullable<Config['nas']> = {
  enabled: true, name: 'Studio NAS', version: 'test', protocolVersion: 1, deviceLifetimeDays: 90,
}

describe('resolveLanTrust', () => {
  it('samples non-internal IPv4 addresses only for an explicit NAS all-interface bind', () => {
    expect(resolveLanTrust('0.0.0.0', ['harness.internal:3080'], nas)).toEqual({
      lanAddresses: ['192.168.1.5', '10.0.0.7'],
      trustedHosts: ['192.168.1.5', '10.0.0.7', 'harness.internal:3080'],
      nas,
    })
  })

  it('preserves explicit authorities without deriving LAN trust for ordinary Web', () => {
    for (const host of ['127.0.0.1', '10.0.0.7', '0.0.0.0']) {
      expect(resolveLanTrust(host, ['lab.internal'])).toEqual({
        lanAddresses: [], trustedHosts: ['lab.internal'],
      })
    }
  })
})
