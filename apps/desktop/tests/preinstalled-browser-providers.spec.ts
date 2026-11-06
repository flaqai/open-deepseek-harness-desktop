import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { PREINSTALLED_BROWSER_PROVIDERS, verifyPreinstalledBrowserProviders } from '../scripts/preinstalled-browser-providers.mjs'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'browser offline ')); roots.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.2.2-alpha.3' }))
  for (const [name, dependencies] of [
    ['@deepseek-ai/dsh-browser-use-bundle', {}],
    ['@deepseek-ai/dsh-browser-use', {}],
    [PREINSTALLED_BROWSER_PROVIDERS[0], { '@playwright/mcp': '0.0.80' }],
    [PREINSTALLED_BROWSER_PROVIDERS[1], { 'chrome-devtools-mcp': '1.9.0' }],
    ['@playwright/mcp', {}], ['chrome-devtools-mcp', {}],
  ] as const) {
    const directory = join(root, 'node_modules', name)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version: name === '@playwright/mcp' ? '0.0.80'
      : name === 'chrome-devtools-mcp' ? '1.9.0' : '0.2.2-alpha.3', dependencies }))
  }
  return root
}
it('verifies carried connectors without loading their code or selecting a Profile bundle', () => {
  expect(() => { verifyPreinstalledBrowserProviders(fixture()) }).not.toThrow()
})
it('refuses a missing connector dependency after deployment', () => {
  const root = fixture(); rmSync(join(root, 'node_modules/@playwright/mcp'), { recursive: true })
  expect(() => { verifyPreinstalledBrowserProviders(root) }).toThrow('missing offline dependency')
})
it('refuses browser executables in the payload', () => {
  const root = fixture(); writeFileSync(join(root, 'chrome.exe'), 'browser')
  expect(() => { verifyPreinstalledBrowserProviders(root) }).toThrow('browser executable is forbidden')
})
it('refuses mismatched provider versions', () => {
  const root = fixture()
  writeFileSync(join(root, 'node_modules', PREINSTALLED_BROWSER_PROVIDERS[0], 'package.json'), JSON.stringify({
    name: PREINSTALLED_BROWSER_PROVIDERS[0], version: '0.2.0-rc.2',
  }))
  expect(() => { verifyPreinstalledBrowserProviders(root) }).toThrow('does not match Harness')
})

it('rejects a missing optional delivery bundle', () => {
  const root = fixture(); rmSync(join(root, 'node_modules/@deepseek-ai/dsh-browser-use-bundle'), { recursive: true })
  expect(() => { verifyPreinstalledBrowserProviders(root) }).toThrow('missing offline dependency')
})
