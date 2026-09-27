import { describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'
import { isTrustedOrbPage } from '../src/orb-navigation.ts'

const shell = '/private/tmp/desktop/orb-shell.html'
const origin = 'http://127.0.0.1:40731'

describe('floating document admission', () => {
  it('admits only the fixed shell and dedicated local chat route', () => {
    expect(isTrustedOrbPage(pathToFileURL(shell).href, shell, undefined)).toBe(true)
    expect(isTrustedOrbPage(`${origin}/?surface=orb`, shell, origin)).toBe(true)
    expect(isTrustedOrbPage(`${origin}/?surface=orb`, shell, undefined)).toBe(false)
  })

  it('rejects external, other local, and query-expanded documents', () => {
    for (const url of [
      'https://example.com/?surface=orb', `${origin}/`, `${origin}/admin?surface=orb`,
      `${origin}/?surface=orb&next=https://example.com`, `${origin}/?surface=orb#fragment`,
      pathToFileURL('/private/tmp/desktop/other.html').href, 'not a URL',
    ]) expect(isTrustedOrbPage(url, shell, origin)).toBe(false)
  })
})
