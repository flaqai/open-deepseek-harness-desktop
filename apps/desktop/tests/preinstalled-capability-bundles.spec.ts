/** Desktop carries optional interaction closures without admitting them into default CLI services. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { OPTIONAL_BUNDLES, ON_DEMAND_BUNDLES, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-official-bundles'
import { parse } from 'yaml'

const root = resolve(import.meta.dirname, '../../..')
interface Manifest {
  name: string
  version: string
  dependencies?: Record<string, string>
  dsh?: { bundle?: { listedByDefault?: boolean } }
}
function readPackage(path: string): Manifest { return JSON.parse(readFileSync(resolve(root, path, 'package.json'), 'utf8')) as Manifest }

it.each([
  ['browser-use-bundle', ['@deepseek-ai/dsh-experimental-browser-use-playwright-mcp', '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp'], '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'],
  ['computer-use-native-bundle', ['@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'], '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'],
] as const)('carries %s through the admitted optional bundle and activates only its selected provider', (directory, providers, selected) => {
  const cli = readPackage('apps/cli')
  const bundle = readPackage(`packages/experimental/${directory}`)
  expect(cli.dependencies?.[bundle.name]).toBe('workspace:*')
  expect(OPTIONAL_BUNDLES).toContain(bundle.name)
  expect(bundle.version).toBe(cli.version)
  expect(bundle.dsh?.bundle?.listedByDefault).toBe(false)
  for (const provider of providers) {
    expect(cli.dependencies?.[provider]).toBeUndefined()
    expect(bundle.dependencies?.[provider]).toBe('workspace:*')
  }
  for (const template of Object.values(PROFILE_TEMPLATES)) expect(template.bundles).not.toContain(bundle.name)
  const patches: unknown = parse(readFileSync(resolve(root, `packages/experimental/${directory}/cordis.patch.yml`), 'utf8'))
  expect(JSON.stringify(patches)).toContain(selected)
  for (const provider of providers.filter(name => name !== selected)) expect(JSON.stringify(patches)).not.toContain(provider)
})

it('declares the already-carried macOS CUA bundle as optional rather than an on-demand default dependency', () => {
  expect(readPackage('apps/cli').dependencies?.['@deepseek-ai/dsh-cua-bundle']).toBe('workspace:*')
  expect(OPTIONAL_BUNDLES).toContain('@deepseek-ai/dsh-cua-bundle')
  expect(ON_DEMAND_BUNDLES).not.toContain('@deepseek-ai/dsh-cua-bundle')
})
