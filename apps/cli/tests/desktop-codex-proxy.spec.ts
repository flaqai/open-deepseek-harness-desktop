import { describe, expect, it } from 'vitest'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { withDesktopCodexProxy } from '../src/desktop-codex-proxy.ts'
import { packageNetworkDiagnostic } from '../src/package-network-diagnostic.ts'

const environment = { DSH_DESKTOP_CODEX_PROXY: 'http://proxy.example:8080/' }
const patches: PatchOptions[] = [{ insert: [
  { id: 'codex', name: '@deepseek-ai/dsh-subagent-codex', config: { model: 'custom-model', env: { CUSTOM: 'keep' } } },
  { id: 'other', name: 'other-provider', config: { env: {} } },
] }]

describe('desktop Codex proxy scope', () => {
  it('changes only Codex runtime config, preserving source patches and environment', () => {
    const before = structuredClone(patches)
    const rows = composeEntries([withDesktopCodexProxy(patches, environment)])
    expect(rows[0]?.config).toEqual({ model: 'custom-model', env: {
      CUSTOM: 'keep', HTTP_PROXY: environment.DSH_DESKTOP_CODEX_PROXY,
      HTTPS_PROXY: environment.DSH_DESKTOP_CODEX_PROXY, NO_PROXY: '127.0.0.1,localhost,::1',
    } })
    expect(rows[1]?.config).toEqual({ env: {} })
    expect(patches).toEqual(before)
    expect(environment).not.toHaveProperty('HTTPS_PROXY')
  })

  it.each(['HTTP_PROXY', 'https_proxy', 'All_Proxy'])('honors explicit %s on launch and provider reload', (key) => {
    expect(withDesktopCodexProxy(patches, { ...environment, [key]: 'http://explicit' })).toBe(patches)
    const override: PatchOptions[] = [...patches, { id: 'codex', config: { env: { [key]: 'http://explicit' } } }]
    expect(composeEntries([withDesktopCodexProxy(override, environment)])[0]?.config)
      .toEqual(composeEntries([override])[0]?.config)
    expect(composeEntries([withDesktopCodexProxy(patches, environment)])[0]?.config)
      .toHaveProperty('env.HTTP_PROXY', environment.DSH_DESKTOP_CODEX_PROXY)
  })

  it('preserves provider-specific bypasses over parent settings', () => {
    const custom: PatchOptions[] = [...patches, { id: 'codex', config: { env: { no_proxy: 'private.example' } } }]
    expect(composeEntries([withDesktopCodexProxy(custom, { ...environment, NO_PROXY: 'parent.example' })])[0]?.config)
      .toHaveProperty('env.no_proxy', 'private.example,127.0.0.1,localhost,::1')
  })

  it('respects an explicitly empty provider proxy and leaves absent providers alone', () => {
    const cleared: PatchOptions[] = [...patches, { id: 'codex', config: { env: { HTTPS_PROXY: '' } } }]
    expect(composeEntries([withDesktopCodexProxy(cleared, environment)]))
      .toEqual(composeEntries([cleared]))
    expect(withDesktopCodexProxy([], environment)).toEqual([])
  })

  it.each(['', 'invalid', 'file:///tmp/proxy', 'http://user:secret@proxy', 'http://proxy/private?token=secret'])('ignores invalid private route %s', (route) => {
    expect(withDesktopCodexProxy(patches, { DSH_DESKTOP_CODEX_PROXY: route })).toBe(patches)
  })
})

describe('package network diagnostics', () => {
  it.each([
    ['UND_ERR_CONNECT_TIMEOUT', 'connect-timeout'], ['ENOTFOUND', 'dns'],
    ['ERR_PNPM_FETCH_407', 'proxy-auth'], ['SELF_SIGNED_CERT_IN_CHAIN', 'tls'],
    ['ERR_PNPM_FETCH_403', 'authentication'], ['ECONNRESET', 'connection'],
    ['ERR_PNPM_META_FETCH_FAIL', 'metadata-fetch'],
  ])('classifies %s without disclosing values', (code, category) => {
    const hint = packageNetworkDiagnostic(`${code} https://private:secret@private.example/repo?token=secret`, 125.8,
      { https_proxy: 'http://private:secret@proxy', SECRET_TOKEN: 'secret' })
    expect(hint).toContain(`network ${category} after 126 ms`)
    expect(hint).toContain('explicit proxy environment present')
    expect(hint).not.toMatch(/secret|private\.example|https?:\/\//u)
  })
  it('explains pnpm configuration precedence without exposing a saved proxy', () => {
    const hint = packageNetworkDiagnostic('ERR_PNPM_META_FETCH_FAIL', 50,
      { PNPM_CONFIG_HTTPS_PROXY: 'http://private:secret@proxy' })
    expect(hint).toContain('pnpm global proxy')
    expect(hint).toContain('Direct connection')
    expect(hint).toContain('Custom proxy')
    expect(hint).toContain('explicit proxy environment present')
    expect(hint).not.toMatch(/private:secret|https?:\/\//u)
  })
  it('does not mislabel tool config as direct access or non-network errors as timeouts', () => {
    expect(packageNetworkDiagnostic('ETIMEDOUT', 50, environment)).toContain('effective route unverified')
    expect(packageNetworkDiagnostic('ERR_PNPM_IGNORED_BUILDS', 50, environment)).toBeUndefined()
  })
})
