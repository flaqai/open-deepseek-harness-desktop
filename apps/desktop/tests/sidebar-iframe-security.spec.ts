import { describe, expect, it } from 'vitest'
import { blockEmbeddedNavigation, blockEmbeddedRequest, isHarnessAddress, parseExternalBrowserUrl, trustedRendererPopupUrl } from '../src/sidebar-iframe-security.ts'

const HARNESS = 'http://127.0.0.1:38123'

describe('Sidebar iframe main-process boundaries', () => {
  it('recognizes the authenticated listener and its loopback aliases, not other services', () => {
    expect(isHarnessAddress('http://localhost:38123/api', HARNESS)).toBe(true)
    expect(isHarnessAddress('http://[::1]:38123/api', HARNESS)).toBe(true)
    expect(isHarnessAddress('http://127.0.0.1:38124/api', HARNESS)).toBe(false)
    expect(isHarnessAddress('https://localhost:38123/api', HARNESS)).toBe(false)
    expect(isHarnessAddress('not a url', HARNESS)).toBe(false)
  })

  it('blocks nested access to Harness and any subframe-initiated top navigation', () => {
    expect(blockEmbeddedNavigation('http://localhost:38123/api', HARNESS, false, false)).toBe(true)
    expect(blockEmbeddedNavigation('https://example.com/', HARNESS, false, false)).toBe(false)
    expect(blockEmbeddedNavigation('https://example.com/', HARNESS, true, true)).toBe(true)
    expect(blockEmbeddedNavigation('https://example.com/', HARNESS, true, false)).toBe(false)
  })

  it('blocks programmatic iframe and nested fetch requests to the authenticated listener', () => {
    expect(blockEmbeddedRequest('http://localhost:38123/', HARNESS, 'subFrame', false)).toBe(true)
    expect(blockEmbeddedRequest('http://localhost:38123/api', HARNESS, 'xhr', true)).toBe(true)
    expect(blockEmbeddedRequest('http://localhost:38123/api', HARNESS, 'xhr', false)).toBe(false)
    expect(blockEmbeddedRequest('https://example.com/', HARNESS, 'subFrame', false)).toBe(false)
  })

  it('accepts only credential-free HTTP(S) external targets outside Harness', () => {
    expect(parseExternalBrowserUrl('https://example.com/help', HARNESS)).toBe('https://example.com/help')
    expect(parseExternalBrowserUrl('http://localhost:8080/', HARNESS)).toBe('http://localhost:8080/')
    for (const value of ['file:///tmp/x', 'javascript:alert(1)', 'https://user:secret@example.com/',
      'http://localhost:38123/', 'https://', '', 42]) {
      expect(() => parseExternalBrowserUrl(value, HARNESS)).toThrow()
    }
  })

  it('opens ordinary HTTPS popups only when the referrer is the Harness document', () => {
    expect(trustedRendererPopupUrl('https://example.com/', `${HARNESS}/chat`, HARNESS, false))
      .toBe('https://example.com/')
    expect(trustedRendererPopupUrl('https://example.com/', 'https://untrusted.example/', HARNESS, false))
      .toBeUndefined()
    expect(trustedRendererPopupUrl('https://example.com/', '', HARNESS, false)).toBeUndefined()
    expect(trustedRendererPopupUrl('https://example.com/', `${HARNESS}/`, HARNESS, true)).toBeUndefined()
    expect(trustedRendererPopupUrl('http://example.com/', `${HARNESS}/`, HARNESS, false)).toBeUndefined()
  })
})
