import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { browserDefaultNeeded, markBrowserDefaultCandidate, configureBrowserDefaultCandidate } from '../src/browser-defaults.ts'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture(value: object = {}) {
  const root = await mkdtemp(join(tmpdir(), 'browser-default-')); roots.push(root)
  await mkdir(join(root, 'profiles/web'), { recursive: true })
  await writeFile(join(root, 'profiles/web/package.json'), JSON.stringify(value))
  return root
}
it('allows a default on fresh and upgraded Profiles without browser preferences', async () => {
  expect(await browserDefaultNeeded(await fixture())).toBe(true)
  expect(await browserDefaultNeeded(await fixture({ dependencies: { arbitrary: '1' }, odsh: { scheduleMigration: 2 } }))).toBe(true)
})
it.each([
  '- id: browser-use\n  disabled: true\n',
  '# BEGIN community-desktop:experimental:browser-use\n',
  '- id: custom\n  name: "@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp"\n',
])('preserves explicit or legacy browser patches: %s', async (patch) => {
  const home = await fixture()
  await writeFile(join(home, 'profiles/web/cordis.patch.yml'), patch)
  expect(await browserDefaultNeeded(home)).toBe(false)
})
it('preserves selected provider bundles and shared-home disabled preferences', async () => {
  const bundled = await fixture({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'] } } })
  expect(await browserDefaultNeeded(bundled)).toBe(false)
  const home = await fixture()
  await writeFile(join(home, 'cordis.patch.yml'), '- id: browser-use\n  disabled: true\n')
  expect(await browserDefaultNeeded(home)).toBe(false)
})
it('marks only the supplied candidate and keeps unrelated preferences', async () => {
  const active = await fixture({ odsh: { scheduleMigration: 2 }, credentials: { source: 'kept' } })
  const candidate = await fixture({ odsh: { scheduleMigration: 2 }, credentials: { source: 'kept' } })
  await markBrowserDefaultCandidate(candidate)
  expect(await browserDefaultNeeded(candidate)).toBe(false)
  expect(await browserDefaultNeeded(active)).toBe(true)
  expect(JSON.parse(await readFile(join(candidate, 'profiles/web/package.json'), 'utf8'))).toEqual({
    odsh: { scheduleMigration: 2, browserDefault: 1 }, credentials: { source: 'kept' },
  })
  await markBrowserDefaultCandidate(candidate)
  expect(await browserDefaultNeeded(candidate)).toBe(false)
})
it('does not mark a pending default merely by inspecting it', async () => {
  const home = await fixture()
  await browserDefaultNeeded(home)
  expect(await browserDefaultNeeded(home)).toBe(true)
})

it('passes only the candidate home and existing transaction lease to the actual configure callback', async () => {
  const active = await fixture()
  const candidate = await fixture()
  const environment = { DSH_HOME: active, DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN: 'owned-lease' }
  let invoked = false
  await configureBrowserDefaultCandidate(candidate, environment, async (received, args) => {
    invoked = true
    expect(received.DSH_HOME).toBe(candidate)
    expect(received.DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN).toBe('owned-lease')
    expect(args).toEqual(['plugin', '--profile', 'web', 'configure-experimental-capability', 'browser-use-playwright-visible'])
  })
  expect(invoked).toBe(true)
  expect(environment.DSH_HOME).toBe(active)
  expect(await browserDefaultNeeded(active)).toBe(true)
  expect(await browserDefaultNeeded(candidate)).toBe(false)
})
it('leaves a failed configuration retryable without a success marker', async () => {
  const candidate = await fixture()
  await expect(configureBrowserDefaultCandidate(candidate, {}, () => Promise.reject(new Error('browser missing'))))
    .rejects.toThrow('browser missing')
  expect(await browserDefaultNeeded(candidate)).toBe(true)
})
