/** Validated, target-specific metadata for a portable plugin dependency bundle. */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import semver from 'semver'
import { inspectImportedPluginArchive } from './imported-plugin-local-source.ts'

export const PORTABLE_PLUGIN_BUNDLE_SCHEMA = 'open-deepseek-harness-desktop/portable-plugin-bundle/v1'

export type PortablePluginPlatform = 'darwin' | 'win32' | 'linux'
export type PortablePluginArchitecture = 'arm64' | 'x64'

export interface PortablePluginTarget {
  readonly platform: PortablePluginPlatform
  readonly architecture: PortablePluginArchitecture
  /** The user-facing operating-system version, not the Desktop release version. */
  readonly osVersion: string
}

export interface PortablePluginArtifact {
  readonly packageName: string
  readonly version: string
  readonly file: string
  readonly sha256: string
}

export interface PortablePluginBundleManifest {
  readonly schema: typeof PORTABLE_PLUGIN_BUNDLE_SCHEMA
  readonly target: PortablePluginTarget
  readonly registry?: string
  readonly artifacts: readonly PortablePluginArtifact[]
  readonly store?: {
    readonly sha256: string
    readonly cacheSha256: string
    readonly verification: 'source-host-rehearsed' | 'target-rehearsal-required'
  }
}

const PACKAGE_NAME = /^(?:@[^/@\s]+\/[^/@\s]+|[^/@\s]+)$/u
const ARTIFACT_FILE = /^artifacts\/[a-f0-9]{64}\.tgz$/u
const SHA256 = /^[a-f0-9]{64}$/u
const OS_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+ -]{0,39}$/u
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_ARTIFACT_BYTES = 200 * 1024 * 1024
const MAX_STORE_FILES = 100_000
const MAX_STORE_BYTES = 4 * 1024 * 1024 * 1024

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parsePublicRegistry(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256 || value.includes('\\') || value.trim() !== value) {
    throw new TypeError('desktop: invalid portable plugin registry')
  }
  let url: URL
  try { url = new URL(value) } catch { throw new TypeError('desktop: invalid portable plugin registry') }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))
    || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new TypeError('desktop: portable plugin registry must be a public HTTPS URL without credentials')
  }
  return url.href
}

export function parsePortablePluginTarget(value: unknown): PortablePluginTarget {
  if (!record(value)
    || (value.platform !== 'darwin' && value.platform !== 'win32' && value.platform !== 'linux')
    || (value.architecture !== 'arm64' && value.architecture !== 'x64')
    || typeof value.osVersion !== 'string' || !OS_VERSION.test(value.osVersion)
    || value.osVersion.trim() !== value.osVersion) {
    throw new TypeError('desktop: invalid portable plugin target')
  }
  return { platform: value.platform, architecture: value.architecture, osVersion: value.osVersion }
}

export function parsePortablePluginBundleManifest(value: unknown): PortablePluginBundleManifest {
  if (!record(value) || value.schema !== PORTABLE_PLUGIN_BUNDLE_SCHEMA || !Array.isArray(value.artifacts)
    || value.artifacts.length > 1000) {
    throw new TypeError('desktop: invalid portable plugin bundle manifest')
  }
  const target = parsePortablePluginTarget(value.target)
  const registry = value.registry === undefined ? undefined : parsePublicRegistry(value.registry)
  let store: PortablePluginBundleManifest['store']
  if (value.store !== undefined) {
    if (!record(value.store) || typeof value.store.sha256 !== 'string' || !SHA256.test(value.store.sha256)
      || typeof value.store.cacheSha256 !== 'string' || !SHA256.test(value.store.cacheSha256)
      || (value.store.verification !== 'source-host-rehearsed'
        && value.store.verification !== 'target-rehearsal-required')) {
      throw new TypeError('desktop: invalid portable plugin store metadata')
    }
    store = { sha256: value.store.sha256, cacheSha256: value.store.cacheSha256, verification: value.store.verification }
  }
  const artifacts: PortablePluginArtifact[] = []
  const names = new Set<string>()
  const files = new Set<string>()
  for (const item of value.artifacts as unknown[]) {
    if (!record(item) || typeof item.packageName !== 'string' || !PACKAGE_NAME.test(item.packageName)
      || typeof item.version !== 'string' || semver.valid(item.version) !== item.version
      || typeof item.file !== 'string' || !ARTIFACT_FILE.test(item.file)
      || typeof item.sha256 !== 'string' || !SHA256.test(item.sha256)
      || names.has(item.packageName) || files.has(item.file)) {
      throw new TypeError('desktop: invalid portable plugin artifact')
    }
    names.add(item.packageName)
    files.add(item.file)
    artifacts.push({
      packageName: item.packageName,
      version: item.version,
      file: item.file,
      sha256: item.sha256,
    })
  }
  return {
    schema: PORTABLE_PLUGIN_BUNDLE_SCHEMA,
    target,
    ...(registry === undefined ? {} : { registry }),
    artifacts,
    ...(store === undefined ? {} : { store }),
  }
}

/** Never accept a bundle built for a different OS family or CPU. OS version is preserved for review. */
export function assertPortablePluginHost(target: PortablePluginTarget, platform = process.platform, architecture = process.arch): void {
  if (target.platform !== platform || target.architecture !== architecture) {
    throw new Error(`desktop: portable plugin bundle targets ${target.platform}/${target.architecture}, not ${platform}/${architecture}`)
  }
}

async function hashRegularFile(file: string): Promise<string> {
  const stats = await lstat(file)
  if (!stats.isFile() || stats.size > MAX_ARTIFACT_BYTES) {
    throw new Error('desktop: portable plugin artifact is not a bounded regular file')
  }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function hashPortableStore(root: string): Promise<string> {
  const hash = createHash('sha256')
  let count = 0
  let bytes = 0
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) throw new Error(`desktop: linked pnpm store entry: ${relative}`)
      if (metadata.isDirectory()) {
        hash.update(`d\0${relative}\0`)
        await walk(path, relative)
        continue
      }
      if (!metadata.isFile() || ++count > MAX_STORE_FILES || (bytes += metadata.size) > MAX_STORE_BYTES) {
        throw new Error('desktop: portable pnpm store contains unsupported or excessive content')
      }
      hash.update(`f\0${relative}\0${metadata.size}\0`)
      for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
    }
  }
  const rootStats = await lstat(root)
  if (!rootStats.isDirectory()) throw new Error('desktop: portable pnpm store is not a regular directory')
  await walk(root, '')
  return hash.digest('hex')
}

/** pnpm's v11 project registrations point outside the store and have no package content. */
async function removePnpmProjectRegistrations(storeDirectory: string): Promise<void> {
  const projects = join(storeDirectory, 'v11', 'projects')
  let entries
  try {
    entries = await readdir(projects, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) {
      throw new Error(`desktop: unexpected pnpm project registration: ${entry.name}`)
    }
    await unlink(join(projects, entry.name))
  }
  await rmdir(projects)
}

async function verifyPreparedInstall(profile: string, artifacts: readonly PortablePluginArtifact[]): Promise<void> {
  const canonicalProfile = await realpath(profile)
  for (const artifact of artifacts) {
    const packageFile = await realpath(join(profile, 'node_modules', ...artifact.packageName.split('/'), 'package.json'))
    const location = relative(canonicalProfile, packageFile)
    if (location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location)) {
      throw new Error(`desktop: plugin resolved outside portable preparation: ${artifact.packageName}`)
    }
    const metadata = await lstat(packageFile)
    if (!metadata.isFile() || metadata.size > MAX_MANIFEST_BYTES) {
      throw new Error(`desktop: portable plugin package metadata is invalid: ${artifact.packageName}`)
    }
    const installed = JSON.parse(await readFile(packageFile, 'utf8')) as { name?: unknown; version?: unknown }
    if (installed.name !== artifact.packageName || installed.version !== artifact.version) {
      throw new Error(`desktop: portable plugin preparation resolved a different version: ${artifact.packageName}`)
    }
  }
}

export interface PortablePluginArchiveSource {
  readonly packageName: string
  readonly version: string
  readonly archive: string
}

export type PortablePluginOfflineInstall = (
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
) => Promise<void>

/** Exercise archive and transitive dependency resolution in a private Profile with networking disabled. */
export async function rehearsePortablePluginBundle(
  directory: string,
  actualTarget: PortablePluginTarget,
  install: PortablePluginOfflineInstall,
): Promise<void> {
  const manifest = await verifyPortablePluginBundle(directory)
  const current = parsePortablePluginTarget(actualTarget)
  if (manifest.target.platform !== current.platform || manifest.target.architecture !== current.architecture
    || manifest.target.osVersion !== current.osVersion) {
    throw new Error('desktop: portable plugin bundle targets a different operating system or version')
  }
  const storeDirectory = join(directory, 'store')
  const storeStats = await lstat(storeDirectory)
  if (!storeStats.isDirectory()) throw new Error('desktop: portable plugin bundle has no regular pnpm store')
  const cacheDirectory = join(directory, 'cache')
  const cacheStats = await lstat(cacheDirectory)
  if (!cacheStats.isDirectory()) throw new Error('desktop: portable plugin bundle has no regular pnpm metadata cache')
  const rehearsal = await mkdtemp(join(tmpdir(), 'dsh-portable-plugin-rehearsal-'))
  try {
    await writeFile(join(rehearsal, 'package.json'), '{"name":"dsh-portable-plugin-rehearsal","private":true}\n', {
      flag: 'wx', mode: 0o600,
    })
    const environment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }),
      ...(process.env.WINDIR === undefined ? {} : { WINDIR: process.env.WINDIR }),
      HOME: rehearsal,
      USERPROFILE: rehearsal,
      APPDATA: rehearsal,
      LOCALAPPDATA: rehearsal,
      TMP: rehearsal,
      TEMP: rehearsal,
      npm_config_userconfig: join(rehearsal, 'no-user-npmrc'),
      npm_config_globalconfig: join(rehearsal, 'no-global-npmrc'),
      npm_config_offline: 'true',
      PNPM_CONFIG_FETCH_RETRIES: '0',
      COREPACK_ENABLE_NETWORK: '0',
      HTTP_PROXY: 'http://127.0.0.1:9',
      HTTPS_PROXY: 'http://127.0.0.1:9',
      ALL_PROXY: 'http://127.0.0.1:9',
    }
    await install([
      'add', '--offline', '--ignore-scripts', '--save-exact', `--store-dir=${storeDirectory}`,
      `--config.cache-dir=${cacheDirectory}`,
      ...(manifest.registry === undefined ? [] : [`--registry=${manifest.registry}`]),
      ...manifest.artifacts.map(artifact => join(directory, artifact.file)),
    ], rehearsal, environment)
    await verifyPreparedInstall(rehearsal, manifest.artifacts)
  } finally {
    await rm(rehearsal, { recursive: true, force: true })
  }
}

/** Fill an isolated store and attest an offline rehearsal only on the exact current target. */
export async function preparePortablePluginBundle(
  directory: string,
  target: PortablePluginTarget,
  actualHost: PortablePluginTarget,
  sources: readonly PortablePluginArchiveSource[],
  registry: string,
  install: PortablePluginOfflineInstall,
): Promise<PortablePluginBundleManifest> {
  const parsedRegistry = parsePublicRegistry(registry)
  const stagedArchives = await writePortablePluginBundle(directory, target, sources)
  const staged = parsePortablePluginBundleManifest({ ...stagedArchives, registry: parsedRegistry })
  const storeDirectory = join(directory, 'store')
  const cacheDirectory = join(directory, 'cache')
  const preparation = await mkdtemp(join(tmpdir(), 'dsh-portable-plugin-fetch-'))
  try {
    await mkdir(storeDirectory, { mode: 0o700 })
    await mkdir(cacheDirectory, { mode: 0o700 })
    await writeFile(join(preparation, 'package.json'), '{"name":"dsh-portable-plugin-fetch","private":true}\n', {
      flag: 'wx', mode: 0o600,
    })
    await writeFile(join(preparation, 'pnpm-workspace.yaml'), [
      'packages:', '  - .', 'supportedArchitectures:', `  os: [${staged.target.platform}]`,
      `  cpu: [${staged.target.architecture}]`, '',
    ].join('\n'), { flag: 'wx', mode: 0o600 })
    const onlineEnvironment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }),
      ...(process.env.WINDIR === undefined ? {} : { WINDIR: process.env.WINDIR }),
      ...(process.env.HTTP_PROXY === undefined ? {} : { HTTP_PROXY: process.env.HTTP_PROXY }),
      ...(process.env.HTTPS_PROXY === undefined ? {} : { HTTPS_PROXY: process.env.HTTPS_PROXY }),
      ...(process.env.ALL_PROXY === undefined ? {} : { ALL_PROXY: process.env.ALL_PROXY }),
      ...(process.env.npm_config_registry === undefined ? {} : { npm_config_registry: process.env.npm_config_registry }),
      HOME: preparation,
      USERPROFILE: preparation,
      APPDATA: preparation,
      LOCALAPPDATA: preparation,
      TMP: preparation,
      TEMP: preparation,
      npm_config_userconfig: join(preparation, 'no-user-npmrc'),
      npm_config_globalconfig: join(preparation, 'no-global-npmrc'),
      npm_config_ignore_scripts: 'true',
    }
    await install([
      'add', '--ignore-scripts', '--save-exact', `--store-dir=${storeDirectory}`,
      `--config.cache-dir=${cacheDirectory}`,
      `--registry=${parsedRegistry}`,
      ...staged.artifacts.map(artifact => join(directory, artifact.file)),
    ], preparation, onlineEnvironment)
    await verifyPreparedInstall(preparation, staged.artifacts)
    const host = parsePortablePluginTarget(actualHost)
    const matchingHost = staged.target.platform === host.platform
      && staged.target.architecture === host.architecture
      && staged.target.osVersion === host.osVersion
    const temporaryStagedManifest = join(directory, `manifest.${randomUUID()}.tmp`)
    await writeFile(temporaryStagedManifest, `${JSON.stringify(staged, undefined, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await rename(temporaryStagedManifest, join(directory, 'manifest.json'))
    if (matchingHost) await rehearsePortablePluginBundle(directory, host, install)
    await removePnpmProjectRegistrations(storeDirectory)
    const store = {
      sha256: await hashPortableStore(storeDirectory),
      cacheSha256: await hashPortableStore(cacheDirectory),
      verification: matchingHost ? 'source-host-rehearsed' as const : 'target-rehearsal-required' as const,
    }
    const completed = parsePortablePluginBundleManifest({ ...staged, store })
    const temporaryManifest = join(directory, `manifest.${randomUUID()}.tmp`)
    await writeFile(temporaryManifest, `${JSON.stringify(completed, undefined, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await rename(temporaryManifest, join(directory, 'manifest.json'))
    return completed
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  } finally {
    await rm(preparation, { recursive: true, force: true })
  }
}

/** Publish original archives as a new bundle directory only after every copy passes integrity checks. */
export async function writePortablePluginBundle(
  directory: string,
  target: PortablePluginTarget,
  sources: readonly PortablePluginArchiveSource[],
): Promise<PortablePluginBundleManifest> {
  const parsedTarget = parsePortablePluginTarget(target)
  const parent = dirname(directory)
  const temporary = join(parent, `.portable-plugins-${randomUUID()}.tmp`)
  await mkdir(temporary, { mode: 0o700 })
  try {
    await mkdir(join(temporary, 'artifacts'), { mode: 0o700 })
    const artifacts: PortablePluginArtifact[] = []
    for (const source of sources) {
      const packageManifest = await inspectImportedPluginArchive(source.archive, source.packageName)
      if (packageManifest.version !== source.version) {
        throw new Error(`desktop: portable plugin archive version mismatch: ${source.packageName}`)
      }
      const sha256 = await hashRegularFile(source.archive)
      const file = `artifacts/${sha256}.tgz`
      const destination = join(temporary, file)
      await copyFile(source.archive, destination)
      if (await hashRegularFile(destination) !== sha256) {
        throw new Error('desktop: portable plugin archive changed while copying')
      }
      const copiedManifest = await inspectImportedPluginArchive(destination, source.packageName)
      if (copiedManifest.version !== source.version) {
        throw new Error(`desktop: copied portable plugin archive version mismatch: ${source.packageName}`)
      }
      artifacts.push({ packageName: source.packageName, version: source.version, file, sha256 })
    }
    const manifest = parsePortablePluginBundleManifest({ schema: PORTABLE_PLUGIN_BUNDLE_SCHEMA, target: parsedTarget, artifacts })
    await writeFile(join(temporary, 'manifest.json'), `${JSON.stringify(manifest, undefined, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await lstat(directory).then(() => { throw new Error('desktop: portable plugin bundle destination already exists') },
      (error: unknown) => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error })
    await rename(temporary, directory)
    return manifest
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}

/** Read only bounded regular files under a validated bundle directory; linked artifacts are rejected. */
export async function verifyPortablePluginBundle(directory: string): Promise<PortablePluginBundleManifest> {
  const rootStats = await lstat(directory)
  const artifactDirStats = await lstat(join(directory, 'artifacts'))
  if (!rootStats.isDirectory() || !artifactDirStats.isDirectory()) {
    throw new Error('desktop: portable plugin bundle must contain regular directories')
  }
  const manifestFile = join(directory, 'manifest.json')
  const manifestStats = await lstat(manifestFile)
  if (!manifestStats.isFile() || manifestStats.size > MAX_MANIFEST_BYTES) {
    throw new Error('desktop: portable plugin manifest is not a bounded regular file')
  }
  const manifest = parsePortablePluginBundleManifest(JSON.parse(await readFile(manifestFile, 'utf8')))
  for (const artifact of manifest.artifacts) {
    const file = join(directory, artifact.file)
    const hash = await hashRegularFile(file)
    if (hash !== artifact.sha256) throw new Error(`desktop: portable plugin artifact failed integrity check: ${artifact.file}`)
    const packageManifest = await inspectImportedPluginArchive(file, artifact.packageName)
    if (packageManifest.version !== artifact.version) {
      throw new Error(`desktop: portable plugin archive version mismatch: ${artifact.packageName}`)
    }
  }
  if (manifest.store !== undefined && await hashPortableStore(join(directory, 'store')) !== manifest.store.sha256) {
    throw new Error('desktop: portable pnpm store failed integrity check')
  }
  if (manifest.store !== undefined && await hashPortableStore(join(directory, 'cache')) !== manifest.store.cacheSha256) {
    throw new Error('desktop: portable pnpm metadata cache failed integrity check')
  }
  return manifest
}

/** Require completed store and metadata-cache checks before a bundle may enter the import flow. */
export async function verifyPreparedPortablePluginBundle(directory: string): Promise<PortablePluginBundleManifest & {
  readonly store: NonNullable<PortablePluginBundleManifest['store']>
}> {
  const manifest = await verifyPortablePluginBundle(directory)
  if (manifest.store === undefined || manifest.registry === undefined) {
    throw new Error('desktop: portable plugin bundle preparation is incomplete')
  }
  return { ...manifest, store: manifest.store }
}
