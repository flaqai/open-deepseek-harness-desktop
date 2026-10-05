import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { parse } from 'yaml'
import { composeEntries } from '../../../packages/boot/app-boot/src/profile.ts'
import { configureNewAgentsAnywhere, hasLegacyPocket } from '../src/agents-anywhere-profile.ts'

const roots: string[] = []
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-aa-profile-'))
  roots.push(root)
  await mkdir(join(root, 'profiles', 'web'), { recursive: true })
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('keeps a new bridge disabled and stores its state beneath the selected home', async () => {
  const root = await fixture()
  expect(await configureNewAgentsAnywhere(root, root)).toBe(true)
  expect(parse(await readFile(join(root, 'profiles', 'web', 'cordis.patch.yml'), 'utf8'))).toEqual([{
    id: 'agents-anywhere-bridge-next', disabled: true,
    config: { dshHome: root, stateRoot: join(root, 'agents-anywhere') },
  }])
  const patch: unknown = parse(await readFile(join(root, 'profiles', 'web', 'cordis.patch.yml'), 'utf8'))
  if (!Array.isArray(patch)) throw new Error('expected a patch list')
  const entries = composeEntries([[{ insert: [{ id: 'agents-anywhere-bridge-next', name: '@agents-anywhere/dsh-bridge-next', config: {} }] }], patch])
  expect(entries.find(entry => entry.id === 'agents-anywhere-bridge-next')).toMatchObject({ disabled: true })
})

it('does not reset a user-enabled bridge or its custom server state', async () => {
  const root = await fixture()
  const path = join(root, 'profiles', 'web', 'cordis.patch.yml')
  const source = '- id: agents-anywhere-bridge-next\n  disabled: false\n  config:\n    stateRoot: /custom/state\n'
  await writeFile(path, source)
  expect(await configureNewAgentsAnywhere(root, root)).toBe(false)
  expect(await readFile(path, 'utf8')).toBe(source)
})

it('writes the eventual home into a first-start candidate', async () => {
  const root = await fixture()
  const candidate = join(root, 'candidate')
  await mkdir(join(candidate, 'profiles', 'web'), { recursive: true })
  await configureNewAgentsAnywhere(root, candidate)
  const entries = parse(await readFile(join(candidate, 'profiles', 'web', 'cordis.patch.yml'), 'utf8')) as Array<{ config: { stateRoot: string } }>
  expect(entries[0]?.config.stateRoot).toBe(join(root, 'agents-anywhere'))
})

it('detects an existing Pocket installation without changing it', async () => {
  const root = await fixture()
  const packagePath = join(root, 'profiles', 'web', 'package.json')
  expect(await hasLegacyPocket(root)).toBe(false)
  const packageSource = JSON.stringify({ dependencies: { 'dsh-pocket': '1.14.5' } })
  await writeFile(packagePath, packageSource)
  expect(await hasLegacyPocket(root)).toBe(true)
  expect(await readFile(packagePath, 'utf8')).toBe(packageSource)
})
