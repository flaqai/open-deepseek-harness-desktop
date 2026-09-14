import { mkdtempSync, mkdirSync, readFileSync, existsSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { load } from 'js-yaml'
import { relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPlugin } from '../src/plugin.ts'
import {
  activateProfilePluginTransaction, prepareProfilePluginTransaction, profilePluginCandidateHome,
  readProfilePluginTransaction, readyProfilePluginTransaction, settleProfilePluginTransaction,
  resumeProfilePluginPreparation,
} from '../src/profile-plugin-transaction.ts'

const homes: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-stage-'))
  homes.push(home)
  const profile = join(home, 'profiles', 'web')
  mkdirSync(join(profile, 'node_modules'), { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { alpha: '1.0.0' }, dsh: { profile: { bundles: ['alpha'] } } }))
  writeFileSync(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages: [.]\nallowBuilds:\n  alpha: false\n')
  writeFileSync(join(profile, 'node_modules', 'generation'), 'old')
  writeFileSync(join(profile, 'cordis.patch.yml'), 'plugins: []\n')
  writeFileSync(join(home, 'settings.yaml'), 'secret: keep\n')
  const record = prepareProfilePluginTransaction(home, 'web')
  const candidate = profilePluginCandidateHome(home, 'web', record.id)
  const candidateProfile = join(candidate, 'profiles', 'web')
  return { home, profile, record, candidate, candidateProfile }
}
function dependencies(profile: string): Record<string, string> {
  return (JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies
}
describe('staged Profile activation', () => {
  it('stages a fresh Profile without initializing the active directory and rolls it back to absent', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-first-deploy-'))
    homes.push(home)
    mkdirSync(join(home, 'profiles/node_modules'), { recursive: true })
    const record = prepareProfilePluginTransaction(home, 'web')
    const candidate = profilePluginCandidateHome(home, 'web', record.id)
    const profile = join(candidate, 'profiles/web')
    mkdirSync(join(profile, 'node_modules'), { recursive: true })
    writeFileSync(join(profile, 'package.json'), '{"dependencies":{},"dsh":{"profile":{"bundles":[]}}}')
    expect(existsSync(join(home, 'profiles/web/package.json'))).toBe(false)
    readyProfilePluginTransaction(home, 'web', record.id)
    activateProfilePluginTransaction(home, 'web', record.id)
    expect(existsSync(join(home, 'profiles/web/package.json'))).toBe(true)
    settleProfilePluginTransaction(home, 'web', record.id, false)
    expect(existsSync(join(home, 'profiles/web/package.json'))).toBe(false)
  })
  it('resumes only preparation from a dead producer and preserves copied candidate files', () => {
    const f = fixture()
    const journal = join(f.home, 'plugin-transactions/web/pending.json')
    writeFileSync(journal, JSON.stringify({ ...f.record, producerPid: 99999999 }))
    writeFileSync(join(f.candidateProfile, 'node_modules', 'copied'), 'keep')
    resumeProfilePluginPreparation(f.home, 'web', f.record.id, process.pid)
    expect(readProfilePluginTransaction(f.home, 'web')?.producerPid).toBe(process.pid)
    expect(readFileSync(join(f.candidateProfile, 'node_modules', 'copied'), 'utf8')).toBe('keep')
    expect(() => { resumeProfilePluginPreparation(f.home, 'web', f.record.id, process.pid) }).toThrow('still alive')
    writeFileSync(journal, JSON.stringify({ ...f.record, producerPid: 99999999, phase: 'activating' }))
    expect(() => { resumeProfilePluginPreparation(f.home, 'web', f.record.id, process.pid) }).toThrow('only interrupted preparation')
  })
  it('rebases a prebuilt candidate store location to the active configuration directory on activation', () => {
    const f = fixture()
    writeFileSync(join(f.candidateProfile, 'node_modules/.modules.yaml'), JSON.stringify({ storeDir: join(f.candidate, '.pnpm-store/v11') }))
    readyProfilePluginTransaction(f.home, 'web', f.record.id)
    activateProfilePluginTransaction(f.home, 'web', f.record.id)
    expect(load(readFileSync(join(f.profile, 'node_modules/.modules.yaml'), 'utf8'))).toEqual({ storeDir: join(f.home, '.pnpm-store/v11') })
  })
  it('activates new seed markers and retained archives together, then removes the new marker on rollback', () => {
    const f = fixture()
    const bundled = join(f.candidate, 'bundled-plugins')
    mkdirSync(bundled, { recursive: true })
    writeFileSync(join(bundled, 'new.seeded.json'), '{"version":"1.0.0"}')
    writeFileSync(join(bundled, 'new.tgz'), 'verified inert archive')
    writeFileSync(join(f.candidateProfile, 'package.json'), JSON.stringify({ dependencies: { alpha: `file:${join(bundled, 'new.tgz')}` } }))
    readyProfilePluginTransaction(f.home, 'web', f.record.id)
    activateProfilePluginTransaction(f.home, 'web', f.record.id)
    expect(dependencies(f.profile).alpha).toBe(`file:${join(f.home, 'bundled-plugins', 'new.tgz')}`)
    expect(readFileSync(join(f.home, 'bundled-plugins', 'new.tgz'), 'utf8')).toBe('verified inert archive')
    expect(existsSync(join(f.home, 'bundled-plugins', 'new.seeded.json'))).toBe(true)
    settleProfilePluginTransaction(f.home, 'web', f.record.id, false)
    expect(existsSync(join(f.home, 'bundled-plugins', 'new.seeded.json'))).toBe(false)
    expect(dependencies(f.profile)).toEqual({ alpha: '1.0.0' })
  })
  it('rebases generated archive IDs on activation and supports a second candidate without changing specs or integrity', () => {
    const f = fixture()
    const archive = join(f.home, 'archive.tgz')
    writeFileSync(archive, 'inert archive locator')
    const candidateId = `file:${relative(f.candidateProfile, archive)}`
    const activeId = `file:${relative(f.profile, archive)}`
    const metadata = {
      lockfileVersion: '9.0',
      importers: { '.': { dependencies: { alpha: { specifier: `file:${archive}`, version: candidateId } } } },
      packages: { [`alpha@${candidateId}`]: { resolution: { integrity: 'sha512-preserved', tarball: candidateId } } },
      snapshots: { [`alpha@${candidateId}(peer@1.0.0)`]: {} },
    }
    writeFileSync(join(f.candidateProfile, 'pnpm-lock.yaml'), JSON.stringify(metadata))
    readyProfilePluginTransaction(f.home, 'web', f.record.id)
    activateProfilePluginTransaction(f.home, 'web', f.record.id)
    const activated = load(readFileSync(join(f.profile, 'pnpm-lock.yaml'), 'utf8')) as typeof metadata
    expect(activated.importers['.'].dependencies.alpha).toEqual({ specifier: `file:${archive}`, version: activeId })
    expect(activated.packages[`alpha@${activeId}`]?.resolution).toEqual({ integrity: 'sha512-preserved', tarball: activeId })
    expect(Object.hasOwn(activated.snapshots, `alpha@${activeId}(peer@1.0.0)`)).toBe(true)
    settleProfilePluginTransaction(f.home, 'web', f.record.id, true)
    const next = prepareProfilePluginTransaction(f.home, 'web')
    expect(next.phase).toBe('preparing')
    settleProfilePluginTransaction(f.home, 'web', next.id, false)
  })
  it.each(['file:', 'link:'])('preserves relative %s sources and exact build denials', (protocol) => {
    const f = fixture()
    settleProfilePluginTransaction(f.home, 'web', f.record.id, false)
    const local = join(f.home, 'local-plugin')
    mkdirSync(local)
    writeFileSync(join(local, 'package.json'), '{"name":"alpha","version":"1.0.0"}')
    const manifest = JSON.stringify({ dependencies: { alpha: `${protocol}../../local-plugin`, remote: 'git+https://example.invalid/repo.git#fixed-commit' } })
    writeFileSync(join(f.profile, 'package.json'), manifest)
    const record = prepareProfilePluginTransaction(f.home, 'web')
    const candidate = profilePluginCandidateHome(f.home, 'web', record.id)
    expect(readFileSync(join(candidate, 'profiles', 'web', 'package.json'), 'utf8')).toBe(manifest)
    expect(realpathSync(join(candidate, 'local-plugin'))).toBe(realpathSync(local))
    expect(readFileSync(join(candidate, 'profiles', 'web', 'pnpm-workspace.yaml'), 'utf8')).toContain('alpha: false')
    settleProfilePluginTransaction(f.home, 'web', record.id, false)
    expect(existsSync(join(local, 'package.json'))).toBe(true)
  })

  it.each(['workspace:*', 'file:../../../outside'])('rejects an unsafe %s source without activating it', (spec) => {
    const f = fixture()
    settleProfilePluginTransaction(f.home, 'web', f.record.id, false)
    const manifest = JSON.stringify({ dependencies: { alpha: spec } })
    writeFileSync(join(f.profile, 'package.json'), manifest)
    expect(() => prepareProfilePluginTransaction(f.home, 'web')).toThrow('cannot be safely staged')
    const record = readProfilePluginTransaction(f.home, 'web')
    if (record === undefined) throw new Error('missing preparation journal')
    settleProfilePluginTransaction(f.home, 'web', record.id, false)
    expect(readFileSync(join(f.profile, 'package.json'), 'utf8')).toBe(manifest)
    expect(readFileSync(join(f.profile, 'node_modules', 'generation'), 'utf8')).toBe('old')
  })

  it('rejects a candidate metadata symlink before changing active dependencies', () => {
    const f = fixture()
    const metadata = join(f.candidateProfile, 'package.json')
    rmSync(metadata)
    symlinkSync(join(f.home, 'settings.yaml'), metadata)
    readyProfilePluginTransaction(f.home, 'web', f.record.id)
    expect(() => { activateProfilePluginTransaction(f.home, 'web', f.record.id) }).toThrow('escaping link')
    settleProfilePluginTransaction(f.home, 'web', f.record.id, false)
    expect(readFileSync(join(f.profile, 'node_modules', 'generation'), 'utf8')).toBe('old')
  })
  it('stages an ordinary CLI install and hands its lease to the desktop without modifying the active Profile', () => {
    const f = fixture()
    settleProfilePluginTransaction(f.home, 'web', f.record.id, false)
    writeFileSync(join(f.profile, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }))
    const pnpm = join(f.home, 'pnpm.mjs')
    writeFileSync(pnpm, `
      import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
      const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
      pkg.dependencies.beta = '1.0.0';
      writeFileSync('package.json', JSON.stringify(pkg));
      mkdirSync('node_modules/beta', { recursive: true });
      writeFileSync('node_modules/beta/package.json', JSON.stringify({ name: 'beta', version: '1.0.0' }));
    `)
    vi.stubEnv('DSH_HOME', f.home)
    vi.stubEnv('DSH_PNPM_BIN', pnpm)
    vi.stubEnv('DSH_DESKTOP_MUTATION_OWNER_PID', String(process.pid))
    vi.stubEnv('DSH_PLUGIN_SNAPSHOT_BATCH', undefined)
    vi.stubEnv('DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN', undefined)
    expect(runPlugin('web', ['add', 'beta@1.0.0'])).toBe(0)
    const pending = readProfilePluginTransaction(f.home, 'web')
    expect(pending?.phase).toBe('prepared')
    expect(dependencies(f.profile)).toEqual({})
    expect(pending).toBeDefined()
    if (pending === undefined) throw new Error('missing candidate')
    vi.stubEnv('DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN', pending.id)
    expect(runPlugin('web', ['transaction', 'activate', pending.id])).toBe(0)
    expect(dependencies(f.profile)).toEqual({ beta: '1.0.0' })
    expect(runPlugin('web', ['transaction', 'rollback', pending.id])).toBe(0)
    expect(runPlugin('web', ['snapshot', 'end-restore-lease'])).toBe(0)
    expect(dependencies(f.profile)).toEqual({})
  })
  it('keeps the active Profile unchanged until activation and restores complete dependencies on failure', () => {
    const f = fixture()
    const original = readFileSync(join(f.profile, 'package.json'), 'utf8')
    writeFileSync(join(f.candidateProfile, 'package.json'), '{"dependencies":{"alpha":"2.0.0"}}')
    writeFileSync(join(f.candidateProfile, 'node_modules', 'generation'), 'new')
    expect(readFileSync(join(f.profile, 'package.json'), 'utf8')).toBe(original)
    expect(readFileSync(join(f.profile, 'node_modules', 'generation'), 'utf8')).toBe('old')
    expect(existsSync(join(f.candidate, 'settings.yaml'))).toBe(false)
    readyProfilePluginTransaction(f.home, 'web', f.record.id)
    activateProfilePluginTransaction(f.home, 'web', f.record.id)
    expect(readFileSync(join(f.profile, 'node_modules', 'generation'), 'utf8')).toBe('new')
    expect(readProfilePluginTransaction(f.home, 'web')?.phase).toBe('checking-startup')
    settleProfilePluginTransaction(f.home, 'web', f.record.id, false)
    expect(readProfilePluginTransaction(f.home, 'web')).toBeUndefined()
    expect(readFileSync(join(f.profile, 'node_modules', 'generation'), 'utf8')).toBe('old')
    expect(readFileSync(join(f.profile, 'package.json'), 'utf8')).toBe(original)
    expect(readFileSync(join(f.profile, 'pnpm-workspace.yaml'), 'utf8')).toContain('alpha: false')
    expect(readFileSync(join(f.home, 'settings.yaml'), 'utf8')).toBe('secret: keep\n')
    expect(readFileSync(join(f.profile, 'cordis.patch.yml'), 'utf8')).toBe('plugins: []\n')
  })

  it('commits only an activated candidate and removes the temporary safety point', () => {
    const f = fixture()
    expect(() => { settleProfilePluginTransaction(f.home, 'web', f.record.id, true) }).toThrow('not awaiting confirmation')
    readyProfilePluginTransaction(f.home, 'web', f.record.id)
    activateProfilePluginTransaction(f.home, 'web', f.record.id)
    settleProfilePluginTransaction(f.home, 'web', f.record.id, true)
    expect(existsSync(join(f.home, 'plugin-snapshots', 'v1', f.record.snapshotId))).toBe(false)
    expect(readProfilePluginTransaction(f.home, 'web')).toBeUndefined()
  })

  it('refuses stale candidates without overwriting a changed active manifest', () => {
    const f = fixture()
    writeFileSync(join(f.profile, 'package.json'), '{"dependencies":{"user":"3.0.0"}}')
    readyProfilePluginTransaction(f.home, 'web', f.record.id)
    expect(() => { activateProfilePluginTransaction(f.home, 'web', f.record.id) }).toThrow('state changed')
    settleProfilePluginTransaction(f.home, 'web', f.record.id, false)
    expect(readFileSync(join(f.profile, 'package.json'), 'utf8')).toContain('user')
  })

  it.each(['activating', 'checking-startup', 'rolling-back'] as const)('recovers an interruption at %s', (phase) => {
    const f = fixture()
    readyProfilePluginTransaction(f.home, 'web', f.record.id)
    activateProfilePluginTransaction(f.home, 'web', f.record.id)
    const pending = readProfilePluginTransaction(f.home, 'web')
    writeFileSync(join(f.home, 'plugin-transactions', 'web', 'pending.json'), JSON.stringify({ ...pending, phase }))
    settleProfilePluginTransaction(f.home, 'web', f.record.id, false)
    expect(readFileSync(join(f.profile, 'node_modules', 'generation'), 'utf8')).toBe('old')
  })

  it('retains evidence rather than pairing an old manifest with missing previous dependencies', () => {
    const f = fixture()
    readyProfilePluginTransaction(f.home, 'web', f.record.id)
    activateProfilePluginTransaction(f.home, 'web', f.record.id)
    rmSync(join(f.home, 'plugin-transactions', 'web', f.record.id, 'previous-node_modules'), { recursive: true })
    expect(() => { settleProfilePluginTransaction(f.home, 'web', f.record.id, false) }).toThrow('previous plugin dependencies are missing')
    expect(readProfilePluginTransaction(f.home, 'web')?.phase).toBe('rolling-back')
  })

  it('rejects forged identities and journal paths without touching user settings', () => {
    const f = fixture()
    expect(() => profilePluginCandidateHome(f.home, 'web', '../outside')).toThrow('invalid plugin transaction ID')
    const journal = join(f.home, 'plugin-transactions', 'web', 'pending.json')
    writeFileSync(journal, JSON.stringify({ ...f.record, files: [{ relativePath: 'settings.yaml', existed: false }] }))
    expect(() => readProfilePluginTransaction(f.home, 'web')).toThrow('corrupt plugin transaction journal')
    expect(readFileSync(join(f.home, 'settings.yaml'), 'utf8')).toBe('secret: keep\n')
  })
})
