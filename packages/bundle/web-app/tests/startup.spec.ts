/**
 * The Web command-line provider over a real Loader tree: its ordinary service
 * releases a consumer whose config reads `ctx.webStartup` directly.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, WEB_STARTUP_SERVICE, type WebStartupValues } from '../src/startup.ts'
import { Config as WebRuntimeConfig } from '../src/index.ts'

/** What one fixture boot observed. */
interface Observed {
  exits: number[]
  out: string
  readerConfig?: WebStartupValues & { nasRuntime?: WebRuntimeConfig['nas'] }
}

const disposers: (() => Promise<void>)[] = []

/** Fixture tree roots, removed after their booted tree has been disposed. */
const tempDirs: string[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

/**
 * Mount the real provider and a consumer using injection-ordered config.
 * @param args - the invocation's inner arguments.
 * @param readBundleNas - whether the consumer evaluates the shipped NAS expression.
 * @returns the service value and observed consumer/process effects.
 */
async function bootProvider(args: string[], readBundleNas = false): Promise<{
  values: WebStartupValues | undefined
  observed: Observed
}> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-web-startup-'))
  tempDirs.push(dir)
  const observed: Observed = { exits: [], out: '' }
  const nasRow = readBundleNas
    ? readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
      .split('\n').find(line => /^\s+nas: !!js /.test(line))
    : undefined
  if (readBundleNas && nasRow === undefined) throw new Error('Web bundle is missing its NAS runtime expression')
  writeFileSync(join(dir, 'reader.mjs'), `
export function apply(_ctx, config) { globalThis.__webStartupObserved.readerConfig = config }
`)
  // Node imports the fixture row outside Vite's source resolver, so delegate
  // to the source-plane plugin already imported by this test.
  writeFileSync(join(dir, 'provider.mjs'), `
export const name = 'web-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__webStartupApply(ctx)
`)
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: reader',
    `  name: ${pathToFileURL(join(dir, 'reader.mjs')).href}`,
    `  inject: [${WEB_STARTUP_SERVICE}]`,
    '  config:',
    '    host: !!js "ctx.webStartup.host ?? (ctx.webStartup.nas ? \'0.0.0.0\' : \'127.0.0.1\')"',
    '    openBrowser: !!js ctx.webStartup.openBrowser',
    '    port: !!js ctx.webStartup.port ?? 3080',
    '    publicUrl: !!js ctx.webStartup.publicUrl',
    '    trustedHosts: !!js ctx.webStartup.trustedHosts',
    '    nas: !!js ctx.webStartup.nas',
    '    deviceLifetimeDays: !!js ctx.webStartup.deviceLifetimeDays',
    ...nasRow === undefined ? [] : [nasRow.replace(/^\s+nas:/, '    nasRuntime:')],
    '- id: provider',
    `  name: ${pathToFileURL(join(dir, 'provider.mjs')).href}`,
    '',
  ].join('\n'))
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  internals.stdout = observing
  internals.stderr = observing
  const globals = globalThis as unknown as {
    __webStartupApply: typeof apply
    __webStartupObserved: Observed
  }
  globals.__webStartupApply = apply
  globals.__webStartupObserved = observed

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return {
    values: ctx.get(WEB_STARTUP_SERVICE) as WebStartupValues | undefined,
    observed,
  }
}

describe('web command-line provider', () => {
  it('publishes each flag and releases direct service expressions', async () => {
    const { values, observed } = await bootProvider([
      '--host', '127.0.0.1',
      '--no-open',
      '--port', '8080',
      '--trusted-host', 'lab.internal', 'lab-2.internal',
      '--trusted-host', '10.0.0.9',
    ])
    expect(values).toEqual({
      host: '127.0.0.1',
      openBrowser: false,
      port: 8080,
      trustedHosts: ['lab.internal', 'lab-2.internal', '10.0.0.9'],
      nas: false,
      deviceLifetimeDays: 90,
    })
    expect(observed.readerConfig).toEqual(values)
    expect(observed.exits).toEqual([])
  })

  it('leaves deployment values to each consumer when flags omit them', async () => {
    const { values, observed } = await bootProvider([])
    expect(values).toEqual({ openBrowser: true, trustedHosts: [], nas: false, deviceLifetimeDays: 90 })
    expect(observed.readerConfig).toEqual({
      host: '127.0.0.1',
      openBrowser: true,
      port: 3080,
      trustedHosts: [],
      nas: false,
      deviceLifetimeDays: 90,
    })
  })

  it('prints its own help and leaves the consumer pending', async () => {
    const { values, observed } = await bootProvider(['--help'])
    expect(observed.out).toContain('dsh --profile web')
    expect(observed.out).toContain('--no-open')
    expect(observed.out).toContain('--public-url')
    expect(observed.out).toContain('--trusted-host')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })

  it('rejects a non-numeric port before the consumer activates', async () => {
    const { values, observed } = await bootProvider(['--port', 'abc'])
    expect(observed.out).toContain('--port must be a number')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('rejects the intentionally unsupported all-interfaces host before the consumer activates', async () => {
    const { values, observed } = await bootProvider(['--host', '0.0.0.0'])
    expect(observed.out).toContain('--host 0.0.0.0 requires --nas')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('allows all-interfaces binding only for an explicitly trusted NAS deployment', async () => {
    const { values, observed } = await bootProvider([
      '--host', '0.0.0.0',
      '--trusted-host', 'harness.example.com',
      '--nas',
      '--nas-name', 'Studio NAS',
      '--pairing-code', '12345678',
      '--device-lifetime-days', '30',
    ])
    expect(values).toEqual({
      host: '0.0.0.0', openBrowser: true, trustedHosts: ['harness.example.com'],
      nas: true, nasName: 'Studio NAS', pairingCode: '12345678', deviceLifetimeDays: 30,
    })
    expect(observed.exits).toEqual([])
  })

  it('requires explicit NAS trust even when a public URL is advertised', async () => {
    const { values, observed } = await bootProvider([
      '--nas', '--public-url', 'https://nas.example/ui',
    ])
    expect(observed.out).toContain('--nas requires at least one --trusted-host authority')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('resolves the shipped NAS expression into the required runtime configuration', async () => {
    const { observed } = await bootProvider([
      '--nas', '--trusted-host', 'nas.example', '--nas-name', 'Studio NAS',
      '--pairing-code', '12345678', '--device-lifetime-days', '30',
    ], true)
    expect(observed.exits).toEqual([])
    const nas = observed.readerConfig?.nasRuntime
    expect(nas).toMatchObject({
      enabled: true, name: 'Studio NAS',
      protocolVersion: 1, pairingCode: '12345678', deviceLifetimeDays: 30,
    })
    expect(nas?.version).toBeTypeOf('string')
    expect(new WebRuntimeConfig({ nas }).nas).toEqual(nas)
  })

  it('publishes --public-url as advertisement only, leaving the fence to --trusted-host', async () => {
    const { values, observed } = await bootProvider([
      '--public-url', 'https://web.example/ui',
      '--trusted-host', 'lab.internal',
    ])
    expect(values).toEqual({
      openBrowser: true,
      publicUrl: 'https://web.example/ui',
      trustedHosts: ['lab.internal'],
      nas: false,
      deviceLifetimeDays: 90,
    })
    expect(observed.readerConfig).toEqual({
      host: '127.0.0.1',
      openBrowser: true,
      port: 3080,
      publicUrl: 'https://web.example/ui',
      trustedHosts: ['lab.internal'],
      nas: false,
      deviceLifetimeDays: 90,
    })
    expect(observed.exits).toEqual([])
  })

  it('defaults an explicitly enabled NAS deployment to all interfaces', async () => {
    const { values, observed } = await bootProvider([
      '--trusted-host', 'harness.example.com',
      '--nas',
      '--nas-name', 'Studio NAS',
      '--pairing-code', '12345678',
    ])
    expect(values).toEqual({
      openBrowser: true, trustedHosts: ['harness.example.com'],
      nas: true, nasName: 'Studio NAS', pairingCode: '12345678', deviceLifetimeDays: 90,
    })
    expect(observed.readerConfig).toMatchObject({ host: '0.0.0.0', nas: true })
    expect(observed.exits).toEqual([])
  })

  it('rejects a malformed --public-url before the consumer activates', async () => {
    // The parser's own suite owns the exhaustive spellings; the provider only
    // has to fail the invocation before any consumer activates.
    const { values, observed } = await bootProvider(['--public-url', '/web/ui'])
    expect(observed.out).toContain('error: --public-url must be an absolute http or https URL of the form http(s)://host[/prefix]')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })
})
