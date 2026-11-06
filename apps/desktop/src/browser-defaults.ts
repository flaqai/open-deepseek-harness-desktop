/** One-time Browser Use default selection inside the Desktop startup candidate. */
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

const BROWSER_CONFIGURATION = /browser-use|browserUse|playwright|chrome-devtools/iu

async function regularText(path: string): Promise<string | undefined> {
  try {
    if (!(await lstat(path)).isFile()) throw new Error('desktop: browser default requires a regular configuration file')
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

interface Manifest {
  odsh?: { browserDefault?: unknown; [key: string]: unknown }
  dsh?: { profile?: { bundles?: unknown } }
  [key: string]: unknown
}
function manifest(source: string | undefined): Manifest {
  const value: unknown = JSON.parse(source ?? '{}')
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('desktop: invalid browser default manifest')
  const odsh: unknown = Reflect.get(value, 'odsh')
  if (odsh !== undefined && (odsh === null || typeof odsh !== 'object' || Array.isArray(odsh))) {
    throw new Error('desktop: invalid browser default preferences')
  }
  return value as Manifest
}

/**
 * Decide whether first-use Browser Use may be selected without replacing any user preference.
 * @param home Active or candidate home; inspection never changes files.
 * @returns True only when neither a successful default nor any explicit browser configuration is present.
 */
export async function browserDefaultNeeded(home: string): Promise<boolean> {
  const current = manifest(await regularText(join(home, 'profiles/web/package.json')))
  if (current.odsh?.browserDefault !== undefined) return false
  if (BROWSER_CONFIGURATION.test(JSON.stringify(current.dsh?.profile?.bundles ?? []))) return false
  for (const file of ['cordis.patch.yml', 'profiles/web/cordis.patch.yml', 'settings.yaml']) {
    const content = await regularText(join(home, file))
    // Preserve even commented legacy selections rather than guessing that a disabled provider was unwanted.
    if (content !== undefined && BROWSER_CONFIGURATION.test(content)) return false
  }
  return true
}

/**
 * Record an applied default in the mutation-owned candidate, committed only after ordinary startup readiness.
 * @param candidateHome Candidate that already contains the successfully configured browser rows.
 * @returns Resolves after the marker has been atomically written; unrelated manifest fields remain intact.
 */
export async function markBrowserDefaultCandidate(candidateHome: string): Promise<void> {
  const path = join(candidateHome, 'profiles/web/package.json')
  const before = await regularText(path)
  if (before === undefined) throw new Error('desktop: browser default Profile was not initialized')
  const current = manifest(before)
  await writeFileAtomic(path, JSON.stringify({ ...current, odsh: { ...current.odsh, browserDefault: 1 } }, null, 2) + '\n',
    { mode: 0o600 })
}

/**
 * Configure the one-time default through a candidate-scoped CLI invocation before marking success.
 * @param home Mutation-owned candidate home.
 * @param environment Existing transaction lease environment; the active-home value is never forwarded.
 * @param configure CLI invocation owned by the Desktop subprocess runner.
 * @returns Resolves after configuration and marker persistence, or leaves the marker absent on failure.
 */
export async function configureBrowserDefaultCandidate(
  home: string,
  environment: NodeJS.ProcessEnv,
  configure: (environment: NodeJS.ProcessEnv, args: readonly string[]) => Promise<void>,
): Promise<void> {
  if (!await browserDefaultNeeded(home)) return
  await configure({ ...environment, DSH_HOME: home },
    ['plugin', '--profile', 'web', 'configure-experimental-capability', 'browser-use-playwright-visible'])
  await markBrowserDefaultCandidate(home)
}
