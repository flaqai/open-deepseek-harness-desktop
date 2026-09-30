/** Resolve trusted desktop-bundled plugin archives for `dsh plugin add`. */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Environment key pointing at the desktop package's verified plugin resources. */
export const DESKTOP_BUNDLED_PLUGINS_DIR_ENV = 'DSH_DESKTOP_BUNDLED_PLUGINS_DIR'

interface DesktopBundledPluginEntry {
  readonly packageName: string
  readonly version: string
  readonly profile: string
  readonly installPolicy: 'startup' | 'manual' | 'diagnostic'
  readonly registrySpec?: string
  readonly archive: string
  readonly integrity: string
}

interface DesktopBundledPluginManifest {
  readonly schema: 2
  readonly plugins: readonly DesktopBundledPluginEntry[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseManifest(value: unknown): DesktopBundledPluginManifest {
  if (!isRecord(value) || value.schema !== 2 || !Array.isArray(value.plugins)) {
    throw new TypeError('dsh: unsupported desktop bundled-plugin manifest')
  }
  const plugins = value.plugins.map((raw): DesktopBundledPluginEntry => {
    if (!isRecord(raw)
      || typeof raw.packageName !== 'string'
      || typeof raw.version !== 'string'
      || typeof raw.profile !== 'string'
      || !['startup', 'manual', 'diagnostic'].includes(String(raw.installPolicy))
      || typeof raw.archive !== 'string'
      || typeof raw.integrity !== 'string'
      || (raw.registrySpec !== undefined && typeof raw.registrySpec !== 'string')) {
      throw new TypeError('dsh: invalid desktop bundled-plugin manifest entry')
    }
    return {
      packageName: raw.packageName,
      version: raw.version,
      profile: raw.profile,
      installPolicy: raw.installPolicy as DesktopBundledPluginEntry['installPolicy'],
      ...(raw.registrySpec === undefined ? {} : { registrySpec: raw.registrySpec }),
      archive: raw.archive,
      integrity: raw.integrity,
    }
  })
  return { schema: 2, plugins }
}

function addTargetIndex(args: readonly string[]): number | undefined {
  if (args[0] !== 'add') return undefined
  let index: number | undefined
  for (let cursor = 1; cursor < args.length; cursor += 1) {
    const argument = args[cursor]
    if (argument !== undefined && argument !== '--' && !argument.startsWith('-')) index = cursor
  }
  return index
}

function profileHasDependency(profileDir: string, packageName: string): boolean {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    return isRecord(manifest)
      && isRecord(manifest.dependencies)
      && typeof manifest.dependencies[packageName] === 'string'
  } catch {
    return false
  }
}

function verifyArchive(resourcesDirectory: string, entry: DesktopBundledPluginEntry): string {
  const archivePath = resolve(resourcesDirectory, entry.archive)
  const escape = relative(resourcesDirectory, archivePath)
  if (escape === '..' || escape.startsWith(`..${sep}`) || isAbsolute(escape)) {
    throw new TypeError(`dsh: bundled plugin archive escapes its resources directory: ${entry.archive}`)
  }
  const integrityMatch = /^sha512-(?<digest>[A-Za-z0-9+/]+={0,2})$/u.exec(entry.integrity)
  if (integrityMatch?.groups?.digest === undefined) {
    throw new TypeError(`dsh: invalid bundled plugin integrity for ${entry.packageName}`)
  }
  const actual = createHash('sha512').update(readFileSync(archivePath)).digest('base64')
  if (actual !== integrityMatch.groups.digest) {
    throw new Error(`dsh: bundled plugin archive integrity mismatch for ${entry.packageName}`)
  }
  return archivePath
}

/**
 * Replace an eligible registry request with the verified archive shipped by
 * the desktop app. A bare package name restores the bundled version only when
 * the dependency is currently absent; explicit newer versions and tags keep
 * their normal registry path.
 * @param profile - Profile receiving the package-manager operation.
 * @param profileDir - Absolute package-manager working directory for the Profile.
 * @param args - Original pnpm arguments received by `dsh plugin`.
 * @param environment - Host-owned process environment used to locate desktop resources.
 * @returns Original arguments or a copy whose package target is the verified local archive.
 */
export function resolveDesktopBundledPluginArgs(
  profile: string,
  profileDir: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  const resourcesDirectory = environment[DESKTOP_BUNDLED_PLUGINS_DIR_ENV]?.trim()
  const targetIndex = addTargetIndex(args)
  if (resourcesDirectory === undefined || resourcesDirectory === '' || targetIndex === undefined) return args
  if (!isAbsolute(resourcesDirectory)) {
    throw new TypeError(`${DESKTOP_BUNDLED_PLUGINS_DIR_ENV} must be an absolute path`)
  }
  const target = args[targetIndex]
  if (target === undefined) return args

  const manifestValue: unknown = JSON.parse(
    readFileSync(join(resourcesDirectory, 'manifest.json'), 'utf8'),
  )
  const manifest = parseManifest(manifestValue)
  const entry = manifest.plugins.find((candidate) => {
    if (candidate.installPolicy === 'diagnostic' || candidate.profile !== profile) return false
    const exactSpec = candidate.registrySpec ?? `${candidate.packageName}@${candidate.version}`
    if (target === exactSpec || target === `${candidate.packageName}@${candidate.version}`) return true
    return target === candidate.packageName && !profileHasDependency(profileDir, candidate.packageName)
  })
  if (entry === undefined) return args

  const archivePath = verifyArchive(resourcesDirectory, entry)
  process.stderr.write(
    `dsh: restoring bundled ${entry.packageName}@${entry.version} from verified desktop archive\n`,
  )
  return args.map((argument, index) => index === targetIndex ? archivePath : argument)
}
