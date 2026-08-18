import { describe, expect, it } from 'vitest'
import { allowsHarnessPermission } from '../src/permissions.ts'

const TRUSTED_ORIGIN = 'http://127.0.0.1:64174'

describe('desktop renderer permission policy', () => {
  it('allows sanitized clipboard writes from the supervised main frame', () => {
    expect(allowsHarnessPermission(
      'clipboard-sanitized-write',
      `${TRUSTED_ORIGIN}/sessions/1`,
      TRUSTED_ORIGIN,
      true,
    )).toBe(true)
  })

  it.each([
    ['clipboard-read', `${TRUSTED_ORIGIN}/`, TRUSTED_ORIGIN, true],
    ['geolocation', `${TRUSTED_ORIGIN}/`, TRUSTED_ORIGIN, true],
    ['clipboard-sanitized-write', `${TRUSTED_ORIGIN}/`, TRUSTED_ORIGIN, false],
    ['clipboard-sanitized-write', 'http://127.0.0.1:64175/', TRUSTED_ORIGIN, true],
    ['clipboard-sanitized-write', 'file:///tmp/loading.html', TRUSTED_ORIGIN, true],
    ['clipboard-sanitized-write', 'not a url', TRUSTED_ORIGIN, true],
    ['clipboard-sanitized-write', undefined, TRUSTED_ORIGIN, true],
    ['clipboard-sanitized-write', `${TRUSTED_ORIGIN}/`, undefined, true],
  ])('denies permission %s outside the narrow clipboard-write policy', (
    permission,
    requestingUrl,
    trustedOrigin,
    isMainFrame,
  ) => {
    expect(allowsHarnessPermission(
      permission,
      requestingUrl,
      trustedOrigin,
      isMainFrame,
    )).toBe(false)
  })
})
