/** Same-filesystem plugin candidates and recoverable activation for the desktop-owned Web Profile. */
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, copyFileSync, cpSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { dump, load } from 'js-yaml'
import { relocateProfilePluginMetadata } from './profile-plugin-relocation.ts'
import {
  createProfilePluginSnapshot, restoreProfilePluginSnapshotFiles, settleProfilePluginSafetySnapshot,
  type ProfilePluginSnapshotFile,
} from '@deepseek-ai/dsh-app-boot'

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SCHEMA = 'dsh/profile-plugin-transaction/v1'

/** Durable activation record; paths are derived from IDs, never read from this file. */
export interface ProfilePluginTransaction {
  readonly schema: typeof SCHEMA
  readonly id: string
  readonly profile: string
  readonly snapshotId: string
  readonly producerPid: number
  readonly hadModules: boolean
  readonly files: readonly ProfilePluginSnapshotFile[]
  readonly phase: 'preparing' | 'prepared' | 'activating' | 'checking-startup' | 'committed' | 'rolling-back' | 'rolled-back'
}

function locations(home: string, profile: string) {
  if (!/^[A-Za-z0-9._~-]{1,64}$/u.test(profile) || profile === '.' || profile === '..') {
    throw new Error('dsh: invalid transaction Profile')
  }
  const root = join(home, 'plugin-transactions', profile)
  return { root, journal: join(root, 'pending.json'), profile: join(home, 'profiles', profile) }
}

function inside(root: string, target: string): void {
  const child = relative(resolve(root), resolve(target))
  if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) throw new Error('dsh: transaction path escapes its home')
  let current = resolve(target)
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) throw new Error('dsh: transaction path has no existing ancestor')
    current = parent
  }
  const physical = relative(realpathSync(root), realpathSync(current))
  if (isAbsolute(physical) || physical === '..' || physical.startsWith(`..${sep}`)) throw new Error('dsh: transaction path follows an escaping link')
}

function writeAtomic(path: string, bytes: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  const fd = openSync(temporary, 'wx', 0o600)
  try {
    try { writeFileSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temporary, path)
  } finally { rmSync(temporary, { force: true }) }
}

function publish(home: string, record: ProfilePluginTransaction): void {
  const { journal } = locations(home, record.profile)
  inside(home, journal)
  writeAtomic(journal, `${JSON.stringify(record)}\n`)
}

/**
 * Read one pending transaction, rejecting corrupt records and indirect paths.
 * @param home - Harness data directory.
 * @param profile - Profile identity.
 * @returns The pending record, or undefined when no transaction exists.
 */
export function readProfilePluginTransaction(home: string, profile: string): ProfilePluginTransaction | undefined {
  const { journal } = locations(home, profile)
  inside(home, journal)
  if (!existsSync(journal)) return undefined
  if (!lstatSync(journal).isFile()) throw new Error('dsh: unsafe plugin transaction journal')
  const record = JSON.parse(readFileSync(journal, 'utf8')) as Partial<ProfilePluginTransaction> | null
  if (record === null || record.schema !== SCHEMA || record.profile !== profile
    || typeof record.id !== 'string' || !ID.test(record.id)
    || typeof record.snapshotId !== 'string' || !ID.test(record.snapshotId)
    || !Number.isSafeInteger(record.producerPid) || (record.producerPid ?? 0) <= 0
    || typeof record.hadModules !== 'boolean'
    || !['preparing', 'prepared', 'activating', 'checking-startup', 'committed', 'rolling-back', 'rolled-back'].includes(record.phase ?? '')
    || !Array.isArray(record.files)
    || record.files.some(file => !validFile(profile, file))
    || new Set(record.files.map((file: ProfilePluginSnapshotFile) => file.relativePath)).size !== record.files.length) {
    throw new Error('dsh: corrupt plugin transaction journal; automatic activation refused')
  }
  return record as ProfilePluginTransaction
}

function validFile(profile: string, value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const file = value as Partial<ProfilePluginSnapshotFile>
  return typeof file.relativePath === 'string' && allowedFile(profile, file.relativePath)
    && typeof file.existed === 'boolean'
    && (!file.existed || (typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(file.sha256)
      && Number.isSafeInteger(file.bytes) && (file.bytes ?? -1) >= 0))
}

function allowedFile(profile: string, path: string): boolean {
  return ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].some(name => path === `profiles/${profile}/${name}`)
    || ['quarantine/profile-plugins.json', 'imported-plugin-restore.v1.json', 'bundled-plugins/snapshot-version-hold.json'].includes(path)
    || /^bundled-plugins\/[A-Za-z0-9._~-]+\.seeded\.json$/u.test(path)
}

function requireTransaction(home: string, profile: string, id: string): ProfilePluginTransaction {
  if (!ID.test(id)) throw new Error('dsh: invalid plugin transaction ID')
  const record = readProfilePluginTransaction(home, profile)
  if (record?.id !== id) throw new Error('dsh: plugin transaction changed or is unavailable')
  return record
}

/**
 * Reclaim preparation only after its producer has died; activation always uses rollback recovery.
 * Caller must hold the Profile mutation lock before changing ownership.
 * @param home - Active data directory.
 * @param profile - Profile identity.
 * @param id - Existing transaction ID.
 * @param ownerPid - New live desktop owner.
 */
export function resumeProfilePluginPreparation(home: string, profile: string, id: string, ownerPid: number): void {
  const record = requireTransaction(home, profile, id)
  if (record.phase !== 'preparing') throw new Error('dsh: only interrupted preparation can be resumed')
  try {
    process.kill(record.producerPid, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) throw new Error('dsh: invalid preparation owner')
    process.kill(ownerPid, 0)
    profilePluginCandidateHome(home, profile, id)
    publish(home, { ...record, producerPid: ownerPid })
    return
  }
  throw new Error('dsh: preparation producer is still alive')
}

/**
 * Resolve the candidate home of an existing transaction.
 * @param home - Active data directory.
 * @param profile - Profile identity.
 * @param id - Opaque transaction ID.
 * @returns The candidate home under the controlled same-disk transaction directory.
 */
export function profilePluginCandidateHome(home: string, profile: string, id: string): string {
  requireTransaction(home, profile, id)
  const candidate = join(locations(home, profile).root, id, 'candidate')
  inside(home, candidate)
  return candidate
}

function copyRegular(source: string, target: string): void {
  if (!lstatSync(source).isFile()) throw new Error('dsh: transaction source must be a regular file')
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  copyFileSync(source, target)
}

function relocateGeneratedMetadata(candidate: string, home: string, profile: string, activating: boolean): void {
  const activeProfile = join(home, 'profiles', profile)
  const candidateProfile = join(candidate, 'profiles', profile)
  for (const file of ['pnpm-lock.yaml', 'node_modules/.pnpm/lock.yaml', 'node_modules/.modules.yaml', 'node_modules/.pnpm-workspace-state-v1.json']) {
    const path = join(candidateProfile, file)
    inside(candidate, path)
    if (!existsSync(path)) continue
    if (!lstatSync(path).isFile()) throw new Error('dsh: pnpm candidate metadata must be a regular file')
    const original = readFileSync(path, 'utf8')
    const parsed: unknown = load(original)
    const moved = relocateProfilePluginMetadata(parsed,
      activating ? candidateProfile : activeProfile,
      activating ? activeProfile : candidateProfile, candidate, home)
    if (JSON.stringify(parsed) !== JSON.stringify(moved)) {
      writeAtomic(path, file.endsWith('.json') ? `${JSON.stringify(moved, null, 2)}\n` : dump(moved, { lineWidth: -1, noRefs: true }))
    }
  }
}

function retainCandidateArchives(candidate: string, home: string, profile: string): void {
  const directory = join(candidate, 'bundled-plugins')
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.name.endsWith('.tgz')) continue
    if (!entry.isFile()) throw new Error('dsh: unsafe candidate plugin archive')
    const source = join(directory, entry.name)
    const target = join(home, 'bundled-plugins', entry.name)
    inside(home, target)
    const bytes = readFileSync(source)
    if (existsSync(target)) {
      if (!lstatSync(target).isFile() || !readFileSync(target).equals(bytes)) throw new Error('dsh: bundled archive changed during preparation')
    } else writeAtomic(target, bytes)
  }
  // Only candidate-owned bundled archives move. User local/Git specs remain literal.
  const manifest = join(candidate, 'profiles', profile, 'package.json')
  const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string' && value.startsWith(`file:${directory}${sep}`)) {
      const archive = value.slice(`file:${directory}${sep}`.length)
      if (archive !== '' && !archive.includes('/') && !archive.includes('\\') && archive.endsWith('.tgz')) {
        return `file:${join(home, 'bundled-plugins', archive)}`
      }
    }
    if (Array.isArray(value)) return value.map(visit)
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]))
    return value
  }
  const moved = visit(parsed)
  if (JSON.stringify(parsed) !== JSON.stringify(moved)) writeAtomic(manifest, `${JSON.stringify(moved, null, 2)}\n`)
  const lock = join(candidate, 'profiles', profile, 'pnpm-lock.yaml')
  if (existsSync(lock)) {
    const parsedLock: unknown = load(readFileSync(lock, 'utf8'))
    const movedLock = visit(parsedLock)
    if (JSON.stringify(parsedLock) !== JSON.stringify(movedLock)) writeAtomic(lock, dump(movedLock, { lineWidth: -1, noRefs: true }))
  }
}

// The manifest and lockfile retain their literal local specs. A candidate-only
// link preserves the original target rather than rewriting a local source as npm.
function projectLocalSources(home: string, candidate: string, profile: string, value: unknown): void {
  if (typeof value === 'string') {
    if (value.startsWith('workspace:')) throw new Error('dsh: this workspace source cannot be safely staged; the active Profile was preserved')
    const match = /^(?:file|link):(.+)$/u.exec(value)
    if (match?.[1] === undefined || isAbsolute(match[1])) return
    const from = resolve(home, 'profiles', profile, match[1])
    const to = resolve(candidate, 'profiles', profile, match[1])
    if (to === from) return
    const local = relative(candidate, to)
    if (local === '' || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
      throw new Error('dsh: this relative local source cannot be safely staged; the active Profile was preserved')
    }
    if (!existsSync(from)) throw new Error('dsh: local plugin source is missing; the active Profile was preserved')
    if (existsSync(to)) {
      if (realpathSync(to) === realpathSync(from)) return
      if (lstatSync(to).isFile() && lstatSync(from).isFile() && readFileSync(to).equals(readFileSync(from))) return
      throw new Error('dsh: local source overlaps candidate state; the active Profile was preserved')
    }
    mkdirSync(dirname(to), { recursive: true, mode: 0o700 })
    symlinkSync(from, to, lstatSync(from).isDirectory() ? 'junction' : 'file')
  } else if (Array.isArray(value)) {
    for (const child of value) projectLocalSources(home, candidate, profile, child)
  } else if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) projectLocalSources(home, candidate, profile, child)
  }
}

/**
 * Capture managed state and prepare an isolated candidate without copying user data.
 * The caller must own the existing Profile mutation lock throughout preparation.
 * @param home - Active data directory.
 * @param profile - Profile identity.
 * @param producerPid - Process retaining preparation ownership across CLI children.
 * @returns The journal for the newly owned candidate.
 */
export function prepareProfilePluginTransaction(home: string, profile: string, producerPid = process.pid): ProfilePluginTransaction {
  if (!Number.isSafeInteger(producerPid) || producerPid <= 0) throw new Error('dsh: invalid transaction producer')
  if (readProfilePluginTransaction(home, profile) !== undefined) throw new Error('dsh: a plugin transaction needs recovery first')
  const paths = locations(home, profile)
  inside(home, paths.profile)
  const modules = join(paths.profile, 'node_modules')
  if (existsSync(modules) && !lstatSync(modules).isDirectory()) throw new Error('dsh: indirect Profile dependencies cannot be staged')
  const snapshot = createProfilePluginSnapshot({ home, profile, kind: 'safety', trigger: 'restore-safety', allowUninitialized: true })
  const record: ProfilePluginTransaction = {
    schema: SCHEMA, id: randomUUID(), snapshotId: snapshot.snapshotId, profile,
    producerPid, hadModules: existsSync(modules), files: snapshot.files, phase: 'preparing',
  }
  publish(home, record)
  const candidate = profilePluginCandidateHome(home, profile, record.id)
  mkdirSync(candidate, { recursive: true, mode: 0o700 })
  for (const file of record.files) {
    if (file.existed) copyRegular(join(home, file.relativePath), join(candidate, file.relativePath))
  }
  if (record.hadModules) cpSync(modules, join(candidate, 'profiles', profile, 'node_modules'), {
    recursive: true, dereference: false, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
  })
  for (const name of ['cordis.patch.yml', '.npmrc']) {
    const source = join(paths.profile, name)
    if (existsSync(source)) copyRegular(source, join(candidate, 'profiles', profile, name))
  }
  const fallback = join(home, 'profiles', 'node_modules')
  if (existsSync(fallback)) {
    mkdirSync(join(candidate, 'profiles'), { recursive: true, mode: 0o700 })
    symlinkSync(fallback, join(candidate, 'profiles', 'node_modules'), 'junction')
  }
  const archives = join(home, 'bundled-plugins')
  if (existsSync(archives)) {
    inside(home, archives)
    for (const entry of readdirSync(archives, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.tgz')) copyRegular(join(archives, entry.name), join(candidate, 'bundled-plugins', entry.name))
    }
  }
  for (const name of ['package.json', 'pnpm-workspace.yaml']) {
    const path = join(paths.profile, name)
    if (!existsSync(path)) continue
    projectLocalSources(home, candidate, profile, load(readFileSync(path, 'utf8')))
  }
  relocateGeneratedMetadata(candidate, home, profile, false)
  return record
}

/**
 * Retain a successfully checked candidate for desktop-owned activation.
 * @param home - Active data directory.
 * @param profile - Profile identity.
 * @param id - Opaque transaction ID.
 */
export function readyProfilePluginTransaction(home: string, profile: string, id: string): void {
  const record = requireTransaction(home, profile, id)
  if (record.phase !== 'preparing') throw new Error('dsh: plugin candidate is not preparing')
  const files = [...record.files]
  const bundled = join(profilePluginCandidateHome(home, profile, id), 'bundled-plugins')
  if (existsSync(bundled)) {
    inside(home, bundled)
    for (const entry of readdirSync(bundled, { withFileTypes: true })) {
      const relativePath = `bundled-plugins/${entry.name}`
      if (!entry.name.endsWith('.seeded.json')) continue
      if (!entry.isFile() || !allowedFile(profile, relativePath)) throw new Error('dsh: unsafe candidate seed marker')
      if (!files.some(file => file.relativePath === relativePath)) files.push({ relativePath, existed: false })
    }
  }
  publish(home, { ...record, files, phase: 'prepared' })
}

/**
 * Activate verified managed files and dependencies after the caller stops Harness.
 * @param home - Active data directory.
 * @param profile - Profile identity.
 * @param id - Opaque transaction ID.
 */
export function activateProfilePluginTransaction(home: string, profile: string, id: string): void {
  const record = requireTransaction(home, profile, id)
  if (record.phase !== 'prepared') throw new Error('dsh: plugin candidate is not prepared')
  const candidate = profilePluginCandidateHome(home, profile, id)
  for (const file of record.files) {
    const path = join(home, file.relativePath)
    inside(home, path)
    const exists = existsSync(path)
    if (exists !== file.existed || (exists && createHash('sha256').update(readFileSync(path)).digest('hex') !== file.sha256)) {
      throw new Error('dsh: active plugin state changed during preparation; activation refused')
    }
    const candidateFile = join(candidate, file.relativePath)
    inside(candidate, candidateFile)
    if (existsSync(candidateFile) && !lstatSync(candidateFile).isFile()) {
      throw new Error('dsh: candidate metadata must be a regular file')
    }
  }
  const paths = locations(home, profile)
  const modules = join(paths.profile, 'node_modules')
  const newModules = join(candidate, 'profiles', profile, 'node_modules')
  inside(candidate, newModules)
  if (!lstatSync(newModules).isDirectory()) throw new Error('dsh: candidate dependencies are not installed')
  retainCandidateArchives(candidate, home, profile)
  relocateGeneratedMetadata(candidate, home, profile, true)
  publish(home, { ...record, phase: 'activating' })
  mkdirSync(paths.profile, { recursive: true, mode: 0o700 })
  if (record.hadModules) renameSync(modules, join(paths.root, id, 'previous-node_modules'))
  renameSync(newModules, modules)
  for (const file of record.files) {
    const source = join(candidate, file.relativePath)
    const target = join(home, file.relativePath)
    inside(candidate, source)
    if (existsSync(source)) writeAtomic(target, readFileSync(source))
    else rmSync(target, { force: true })
  }
  publish(home, { ...record, phase: 'checking-startup' })
}

/**
 * Commit only after normal readiness, or restore the complete pre-activation state.
 * @param home - Active data directory.
 * @param profile - Profile identity.
 * @param id - Opaque transaction ID.
 * @param commit - True only for a proven healthy ordinary Profile.
 */
export function settleProfilePluginTransaction(home: string, profile: string, id: string, commit: boolean): void {
  const record = requireTransaction(home, profile, id)
  const paths = locations(home, profile)
  const owned = join(paths.root, id)
  inside(home, owned)
  if (commit && record.phase !== 'checking-startup' && record.phase !== 'committed') throw new Error('dsh: plugin startup is not awaiting confirmation')
  if (commit || record.phase === 'committed') publish(home, { ...record, phase: 'committed' })
  else if (record.phase === 'activating' || record.phase === 'checking-startup' || record.phase === 'rolling-back') {
    publish(home, { ...record, phase: 'rolling-back' })
    const backup = join(owned, 'previous-node_modules')
    const active = join(paths.profile, 'node_modules')
    inside(home, active)
    inside(home, backup)
    if (existsSync(backup)) {
      if (existsSync(active)) renameSync(active, join(owned, 'rejected-node_modules'))
      renameSync(backup, active)
    } else if (!record.hadModules && existsSync(active)) {
      renameSync(active, join(owned, 'rejected-node_modules'))
    } else if (record.hadModules && (!existsSync(active)
      || (!existsSync(join(owned, 'candidate', 'profiles', profile, 'node_modules'))
        && !existsSync(join(owned, 'rejected-node_modules'))))) {
      throw new Error('dsh: previous plugin dependencies are missing; recovery journal was retained')
    }
    restoreProfilePluginSnapshotFiles({ home, profile, snapshotId: record.snapshotId })
    publish(home, { ...record, phase: 'rolled-back' })
  }
  // The journal remains until both state restoration and dependency restoration
  // have succeeded, so a failed cleanup is retryable on the next launch.
  if (existsSync(join(home, 'plugin-snapshots', 'v1', record.snapshotId))) {
    settleProfilePluginSafetySnapshot({ home, profile, snapshotId: record.snapshotId })
  }
  if (existsSync(owned)) {
    if (!lstatSync(owned).isDirectory()) throw new Error('dsh: unsafe transaction cleanup directory')
    rmSync(owned, { recursive: true })
  }
  rmSync(paths.journal)
}

/**
 * Leave an inert lab candidate awaiting startup so a separate CLI can exercise recovery.
 * @param home - Empty, isolated diagnostic home selected by the desktop lab.
 * @returns The opaque transaction ID retained in its activation journal.
 */
export function createProfileTransactionInterruptionExercise(home: string): string {
  const profile = locations(home, 'web').profile
  if (existsSync(profile)) throw new Error('dsh: transaction exercise requires an empty diagnostic Profile')
  mkdirSync(join(profile, 'node_modules'), { recursive: true, mode: 0o700 })
  writeAtomic(join(profile, 'package.json'), JSON.stringify({ private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }))
  writeAtomic(join(profile, 'node_modules', 'diagnostic-generation'), 'healthy')
  const record = prepareProfilePluginTransaction(home, 'web')
  const candidate = profilePluginCandidateHome(home, 'web', record.id)
  writeAtomic(join(candidate, 'profiles', 'web', 'node_modules', 'diagnostic-generation'), 'unconfirmed')
  readyProfilePluginTransaction(home, 'web', record.id)
  activateProfilePluginTransaction(home, 'web', record.id)
  return record.id
}
