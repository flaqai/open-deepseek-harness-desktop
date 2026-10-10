import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { inspectLegacyConfig, legacyConfigExternalWriterActive, migrateLegacyConfigCandidate } from '../src/legacy-config-migration.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture(source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'desktop-legacy-config-'))
  roots.push(root)
  await mkdir(join(root, 'profiles/web'), { recursive: true })
  await writeFile(join(root, 'profiles/web/cordis.patch.yml'), source)
  return root
}

it('preserves both mode and every instruction field when an explicit tools choice is needed', async () => {
  const home = await fixture('- id: tools\n  config:\n    mode: both\n')
  const source = `- id: agent-instructions\n  config:\n    dshHome: ${JSON.stringify(home)}\n    maxBytes: 100\n- id: tools\n  config:\n    mode: both\n`
  await writeFile(join(home, 'profiles/web/cordis.patch.yml'), source)
  const plan = await inspectLegacyConfig(home, home)
  expect(plan.issues).toEqual([{ code: 'desktop.legacy-tools-mode', file: 'profiles/web/cordis.patch.yml', row: 'tools' }])
  await expect(migrateLegacyConfigCandidate(home, home, plan)).rejects.toThrow('explicit user decision')
  expect(await readFile(join(home, 'profiles/web/cordis.patch.yml'), 'utf8')).toBe(source)
})

it('backs up equivalent instruction rows individually without modifying other providers or private data', async () => {
  const home = await fixture('[]\n')
  const source = `# preserved comment\n- insert:\n    - id: custom-instructions\n      name: '@deepseek-ai/dsh-agent-instructions'\n      config:\n        dshHome: ${JSON.stringify(home)}\n        maxBytes: 100\n    - id: filesystem\n      config:\n        dshHome: /other-home\n`
  await writeFile(join(home, 'profiles/web/cordis.patch.yml'), source)
  await writeFile(join(home, 'credentials.yaml'), 'private credential bytes')
  await writeFile(join(home, 'session.jsonl'), 'private history bytes')
  const plan = await inspectLegacyConfig(home, home)
  expect(plan.issues).toEqual([])
  expect(await migrateLegacyConfigCandidate(home, home, plan)).toBe(1)
  const after = await readFile(join(home, 'profiles/web/cordis.patch.yml'), 'utf8')
  expect(after).toContain('# preserved comment')
  expect(after).toContain('maxBytes: 100')
  expect(after).toContain('dshHome: /other-home')
  expect(after).not.toContain(JSON.stringify(home))
  const backups = await readdir(join(home, 'diagnostics/config-backups'))
  expect(backups).toHaveLength(1)
  expect(await readFile(join(home, 'diagnostics/config-backups', backups[0]!), 'utf8')).toBe(source)
  const repeated = await inspectLegacyConfig(home, home)
  expect(await migrateLegacyConfigCandidate(home, home, repeated)).toBe(0)
  expect(await readFile(join(home, 'credentials.yaml'), 'utf8')).toBe('private credential bytes')
  expect(await readFile(join(home, 'session.jsonl'), 'utf8')).toBe('private history bytes')
})

it.each(['/other-home', 'relative-home', '!!js process.env.DSH_HOME'])('diagnoses ambiguous instruction roots without evaluating %s', async (value) => {
  const source = `- id: agent-instructions\n  config:\n    dshHome: ${value}\n`
  const home = await fixture(source)
  expect((await inspectLegacyConfig(home, home)).issues).toEqual([
    { code: 'desktop.legacy-instruction-home', file: 'profiles/web/cordis.patch.yml', row: 'agent-instructions' },
  ])
  expect(await readFile(join(home, 'profiles/web/cordis.patch.yml'), 'utf8')).toBe(source)
})

it('refuses a plan if another writer changed configuration after inspection', async () => {
  const home = await fixture('[]\n')
  await writeFile(join(home, 'profiles/web/cordis.patch.yml'), `- id: agent-instructions\n  config:\n    dshHome: ${JSON.stringify(home)}\n`)
  const plan = await inspectLegacyConfig(home, home)
  await writeFile(join(home, 'profiles/web/cordis.patch.yml'), '# user edit\n[]\n')
  await expect(migrateLegacyConfigCandidate(home, home, plan)).rejects.toThrow('changed after inspection')
})

it.each(['diagnostics', 'diagnostics/config-backups'])('rejects a symlink at backup ancestor %s before writing outside the active home', async (relative) => {
  const home = await fixture('[]\n')
  const external = await fixture('[]\n')
  const source = `- id: agent-instructions\n  config:\n    dshHome: ${JSON.stringify(home)}\n`
  await writeFile(join(home, 'profiles/web/cordis.patch.yml'), source)
  if (relative.includes('/')) await mkdir(join(home, 'diagnostics'))
  await symlink(external, join(home, relative), 'dir')
  const before = await readdir(external)
  const plan = await inspectLegacyConfig(home, home)
  await expect(migrateLegacyConfigCandidate(home, home, plan)).rejects.toThrow('unsafe legacy configuration backup directory')
  expect(await readdir(external)).toEqual(before)
  expect(await readFile(join(home, 'profiles/web/cordis.patch.yml'), 'utf8')).toBe(source)
})

it('migrates copied home and Profile patches while retaining the live configuration until activation', async () => {
  const active = await fixture('[]\n')
  const candidate = await fixture('[]\n')
  const homeSource = `- id: agent-instructions\n  config:\n    dshHome: ${JSON.stringify(active)}\n    maxBytes: 200\n`
  const profileSource = `- insert:\n    - id: local.instructions\n      name: '@deepseek-ai/dsh-agent-instructions'\n      config:\n        dshHome: ${JSON.stringify(active)}\n        maxBytes: 300\n`
  for (const home of [active, candidate]) {
    await writeFile(join(home, 'cordis.patch.yml'), homeSource)
    await writeFile(join(home, 'profiles/web/cordis.patch.yml'), profileSource)
  }
  const plan = await inspectLegacyConfig(candidate, active)
  expect(plan.changes).toHaveLength(2)
  expect(await migrateLegacyConfigCandidate(candidate, active, plan)).toBe(2)
  expect(await readFile(join(active, 'cordis.patch.yml'), 'utf8')).toBe(homeSource)
  expect(await readFile(join(active, 'profiles/web/cordis.patch.yml'), 'utf8')).toBe(profileSource)
  expect(await readFile(join(candidate, 'cordis.patch.yml'), 'utf8')).not.toContain('dshHome:')
  expect(await readFile(join(candidate, 'profiles/web/cordis.patch.yml'), 'utf8')).not.toContain('dshHome:')
  expect(await readdir(join(active, 'diagnostics/config-backups'))).toHaveLength(2)
  expect((await inspectLegacyConfig(candidate, active)).changes).toEqual([])
})

it('diagnoses an environment both override even when no patch selects it', async () => {
  const home = await fixture('[]\n')
  expect((await inspectLegacyConfig(home, home, 'both')).issues).toEqual([
    { code: 'desktop.legacy-tools-mode', file: 'DSH_TOOLS_MODE', row: 'tools' },
  ])
})

it('keeps a shared home patch intact while another Profile holds a writer lease', async () => {
  const home = await fixture('[]\n')
  const source = `- id: agent-instructions\n  config:\n    dshHome: ${JSON.stringify(home)}\n`
  await writeFile(join(home, 'cordis.patch.yml'), source)
  const plan = await inspectLegacyConfig(home, home)
  await mkdir(join(home, 'plugin-snapshots/v1'), { recursive: true })
  await writeFile(join(home, 'plugin-snapshots/v1/.profile-plugin-mutation.headless.lock'), JSON.stringify({ pid: process.pid }))
  expect(await legacyConfigExternalWriterActive(home)).toBe(true)
  await expect(migrateLegacyConfigCandidate(home, home, plan)).rejects.toThrow('another Profile writer')
  expect(await readFile(join(home, 'cordis.patch.yml'), 'utf8')).toBe(source)
})
