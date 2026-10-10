import { mkdtempSync, mkdirSync, readFileSync, existsSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, relative, win32 } from 'node:path'
import { tmpdir } from 'node:os'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPlugin } from '../src/plugin.ts'
import {
  activateProfilePluginTransaction, prepareProfilePluginTransaction, profilePluginCandidateHome,
  readProfilePluginTransaction, readyProfilePluginTransaction, settleProfilePluginTransaction,
  relocateProfilePluginArchiveReferences, resumeProfilePluginPreparation,
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
  it.each([true, false])('activates and rolls back the home patch with its prior existence %s', (existed) => {
    const f = fixture()
    settleProfilePluginTransaction(f.home, 'web', f.record.id, false)
    const active = join(f.home, 'cordis.patch.yml')
    const original = 'plugins: []\n# original home patch\n'
    if (existed) writeFileSync(active, original)
    const record = prepareProfilePluginTransaction(f.home, 'web')
    const candidate = profilePluginCandidateHome(f.home, 'web', record.id)
    expect(existsSync(join(candidate, 'cordis.patch.yml'))).toBe(existed)
    writeFileSync(join(candidate, 'cordis.patch.yml'), 'plugins: []\n# migrated home patch\n')
    readyProfilePluginTransaction(f.home, 'web', record.id)
    activateProfilePluginTransaction(f.home, 'web', record.id)
    expect(readFileSync(active, 'utf8')).toContain('migrated home patch')
    settleProfilePluginTransaction(f.home, 'web', record.id, false)
    expect(existsSync(active)).toBe(existed)
    if (existed) expect(readFileSync(active, 'utf8')).toBe(original)
    expect(readFileSync(join(f.home, 'settings.yaml'), 'utf8')).toBe('secret: keep\n')
  })

  it('retains a different transaction when a preallocated prepare request is rejected', () => {
    const f = fixture()
    vi.stubEnv('DSH_HOME', f.home)
    vi.stubEnv('DSH_DESKTOP_MUTATION_OWNER_PID', String(process.pid))
    vi.stubEnv('DSH_PLUGIN_SNAPSHOT_BATCH', '1')
    expect(() => runPlugin('web', ['transaction', 'prepare', '11111111-1111-4111-8111-111111111111'])).toThrow('needs recovery first')
    expect(() => runPlugin('web', ['transaction', 'prepare'])).toThrow('needs recovery first')
    expect(readProfilePluginTransaction(f.home, 'web')?.id).toBe(f.record.id)
    expect(readFileSync(join(f.profile, 'node_modules/generation'), 'utf8')).toBe('old')
  })

  it('publishes the caller-assigned identity and rejects unsafe IDs before writing', () => {
    const f = fixture()
    settleProfilePluginTransaction(f.home, 'web', f.record.id, false)
    expect(() => prepareProfilePluginTransaction(f.home, 'web', process.pid, '../bad')).toThrow('invalid transaction ID')
    expect(readProfilePluginTransaction(f.home, 'web')).toBeUndefined()
    const id = '11111111-1111-4111-8111-111111111111'
    expect(prepareProfilePluginTransaction(f.home, 'web', process.pid, id).id).toBe(id)
  })
  it('accepts host compatibility overrides captured by the shared snapshot format', () => {
    const f = fixture()
    settleProfilePluginTransaction(f.home, 'web', f.record.id, false)
    mkdirSync(join(f.home, 'quarantine'), { recursive: true })
    writeFileSync(join(f.home, 'quarantine', 'host-version-overrides.json'), '{}')
    const record = prepareProfilePluginTransaction(f.home, 'web')
    expect(readProfilePluginTransaction(f.home, 'web')?.files).toEqual(record.files)
    expect(record.files.some(file => file.relativePath === 'quarantine/host-version-overrides.json')).toBe(true)
  })
  it('relocates pnpm-normalized Windows archive locators without changing other local sources', () => {
    const source = String.raw`C:\Users\Person\AppData\Roaming\open-deepseek-harness-desktop\dsh-home\plugin-transactions\web\3b6dade4-2ed0-48d7-aab4-660532802cba\candidate\bundled-plugins`
    const target = String.raw`C:\Users\Person\AppData\Roaming\open-deepseek-harness-desktop\dsh-home\bundled-plugins`
    const archive = `${source.replaceAll('\\', '/')}/dshmarket-1.45.1.tgz`
    expect(relocateProfilePluginArchiveReferences({
      dependencies: { dshmarket: `file:${archive}`, local: 'file:C:/plugins/local' },
      packages: { [`dshmarket@file:${archive}`]: { resolution: { tarball: `file:${archive}` } } },
    }, source, target)).toEqual({
      dependencies: { dshmarket: `file:${win32.join(target, 'dshmarket-1.45.1.tgz')}`, local: 'file:C:/plugins/local' },
      packages: {
        [`dshmarket@file:${win32.join(target, 'dshmarket-1.45.1.tgz')}`]: {
          resolution: { tarball: `file:${win32.join(target, 'dshmarket-1.45.1.tgz')}` },
        },
      },
    })
  })

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

  it('stabilizes a same-drive relative local dependency link before moving candidate modules', () => {
    const f = fixture()
    const local = join(f.home, 'local-plugin')
    mkdirSync(local)
    writeFileSync(join(local, 'package.json'), '{"name":"local-plugin","version":"1.0.0"}')
    const candidateLink = join(f.candidateProfile, 'node_modules', 'local-plugin')
    symlinkSync(relative(join(f.candidateProfile, 'node_modules'), local), candidateLink, 'dir')
    readyProfilePluginTransaction(f.home, 'web', f.record.id)
    activateProfilePluginTransaction(f.home, 'web', f.record.id)
    expect(realpathSync(join(f.profile, 'node_modules', 'local-plugin'))).toBe(realpathSync(local))
  })

  it('rejects a missing candidate dependency link before changing active dependencies', () => {
    const f = fixture()
    const candidateLink = join(f.candidateProfile, 'node_modules', 'missing-plugin')
    symlinkSync('../../../../missing-plugin', candidateLink, 'dir')
    readyProfilePluginTransaction(f.home, 'web', f.record.id)
    expect(() => { activateProfilePluginTransaction(f.home, 'web', f.record.id) }).toThrow('missing target')
    expect(readFileSync(join(f.profile, 'node_modules', 'generation'), 'utf8')).toBe('old')
  })

  it('removes a generated bin link whose package target is already absent', () => {
    const f = fixture()
    const bin = join(f.candidateProfile, 'node_modules', '.bin')
    mkdirSync(bin)
    symlinkSync('../cloudflared/lib/cloudflared.js', join(bin, 'cloudflared'))
    readyProfilePluginTransaction(f.home, 'web', f.record.id)

    activateProfilePluginTransaction(f.home, 'web', f.record.id)

    expect(existsSync(join(f.profile, 'node_modules', '.bin', 'cloudflared'))).toBe(false)
    expect(readFileSync(join(f.profile, 'node_modules', 'generation'), 'utf8')).toBe('old')
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
  it('does not request desktop activation when a package manager reports success without installing the plugin', () => {
    const f = fixture()
    settleProfilePluginTransaction(f.home, 'web', f.record.id, false)
    writeFileSync(join(f.profile, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }))
    const pnpm = join(f.home, 'pnpm.mjs')
    writeFileSync(pnpm, 'process.exit(0)\n')
    vi.stubEnv('DSH_HOME', f.home)
    vi.stubEnv('DSH_PNPM_BIN', pnpm)
    vi.stubEnv('DSH_DESKTOP_MUTATION_OWNER_PID', String(process.pid))
    vi.stubEnv('DSH_PLUGIN_SNAPSHOT_BATCH', undefined)
    vi.stubEnv('DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN', undefined)
    expect(runPlugin('web', ['add', 'beta@1.0.0'])).toBe(1)
    expect(readProfilePluginTransaction(f.home, 'web')).toBeUndefined()
    expect(dependencies(f.profile)).toEqual({})
  })
  it('repairs retained archives from a deleted transaction before retrying a plugin install', () => {
    const f = fixture()
    settleProfilePluginTransaction(f.home, 'web', f.record.id, false)
    const archiveName = 'bundled-alpha-1.0.0.tgz'
    const activeArchive = join(f.home, 'bundled-plugins', archiveName)
    mkdirSync(join(f.home, 'bundled-plugins'), { recursive: true })
    writeFileSync(activeArchive, 'retained archive')
    const staleId = '3b6dade4-2ed0-48d7-aab4-660532802cba'
    const staleArchive = join(f.home, 'plugin-transactions', 'web', staleId, 'candidate', 'bundled-plugins', archiveName)
    writeFileSync(join(f.profile, 'package.json'), JSON.stringify({
      dependencies: { alpha: `file:${staleArchive}` }, dsh: { profile: { bundles: ['alpha'] } },
    }))
    writeFileSync(join(f.profile, 'pnpm-lock.yaml'), JSON.stringify({
      lockfileVersion: '9.0',
      importers: { '.': { dependencies: { alpha: { specifier: `file:${staleArchive}`, version: `file:${staleArchive}` } } } },
      packages: { [`alpha@file:${staleArchive}`]: { resolution: { tarball: `file:${staleArchive}` } } },
    }))
    const pnpm = join(f.home, 'pnpm.mjs')
    writeFileSync(pnpm, `
      import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
      import { fileURLToPath } from 'node:url';
      const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
      const alpha = pkg.dependencies.alpha;
      if (!alpha.startsWith('file:') || !existsSync(fileURLToPath(new URL(alpha)))) process.exit(2);
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
    expect(dependencies(f.profile).alpha).toBe(`file:${staleArchive}`)
    if (pending === undefined) throw new Error('missing repaired candidate')
    vi.stubEnv('DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN', pending.id)
    expect(runPlugin('web', ['transaction', 'activate', pending.id])).toBe(0)
    expect(dependencies(f.profile)).toEqual({ alpha: `file:${activeArchive}`, beta: '1.0.0' })
    expect(runPlugin('web', ['transaction', 'commit', pending.id])).toBe(0)
    expect(runPlugin('web', ['snapshot', 'end-restore-lease'])).toBe(0)
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
