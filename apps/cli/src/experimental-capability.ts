/** Guarded Profile composition for Desktop-owned experimental capability recipes. */
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, win32 } from 'node:path'
import { loadOptionalPatches, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'

export type ExperimentalCapabilityRecipe =
  | 'browser-use-playwright-visible'
  | 'browser-use-devtools-visible'
  | 'computer-use-native'
  | 'computer-use-mcp'

/** Supported Computer Use compositions; the author-style provider is not loadable yet. */
export type ComputerUseBackendSelection = 'official-native' | 'official-mcp' | 'off'

interface Recipe {
  readonly owner: 'browser-use' | 'computer-use'
  readonly yaml: string
}

export interface ChromiumDiscoveryOptions {
  readonly platform?: NodeJS.Platform
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly exists?: (filename: string) => boolean
}

/**
 * Locate an already-installed system Chrome or Chromium without downloading a browser runtime.
 * @param options - Optional platform, environment, and filesystem observations used during discovery.
 * @returns Absolute executable path selected for the browser provider.
 * @throws When no supported executable exists in an explicit or standard location.
 */
export function resolveSystemChromiumExecutable(options: ChromiumDiscoveryOptions = {}): string {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const exists = options.exists ?? existsSync
  const explicit = env.CHROME_PATH?.trim()
  const candidates: string[] = explicit === undefined || explicit === '' ? [] : [explicit]

  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    )
    if (env.HOME !== undefined) {
      candidates.push(
        join(env.HOME, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
        join(env.HOME, 'Applications/Chromium.app/Contents/MacOS/Chromium'),
      )
    }
  } else if (platform === 'win32') {
    for (const root of [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)']]) {
      if (root !== undefined) candidates.push(win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    }
  } else if (platform === 'linux') {
    const pathDelimiter = platform === process.platform ? delimiter : ':'
    const directories = (env.PATH ?? '').split(pathDelimiter).filter(Boolean)
    for (const directory of directories) {
      for (const executable of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
        candidates.push(join(directory, executable))
      }
    }
    candidates.push('/snap/bin/chromium')
  }

  const executable = candidates.find(candidate => exists(candidate))
  if (executable !== undefined) return executable
  throw new Error('dsh: no system Chrome or Chromium installation was found; install one or set CHROME_PATH')
}

function browserRecipe(provider: string, discovery: ChromiumDiscoveryOptions): Recipe {
  const executablePath = resolveSystemChromiumExecutable(discovery)
  return {
    owner: 'browser-use',
    yaml: [
      '- insert:',
      '    - id: community-desktop.experimental.browser-use',
      "      name: '@deepseek-ai/dsh-browser-use'",
      '    - id: community-desktop.experimental.browser-use-provider',
      `      name: '${provider}'`,
      '      config:',
      '        mode: launch',
      '        headless: false',
      `        executablePath: ${JSON.stringify(executablePath)}`,
    ].join('\n'),
  }
}

const RECIPES = {
  'computer-use-native': {
    owner: 'computer-use',
    yaml: [
      '- insert:',
      '    - id: community-desktop.experimental.computer-use',
      "      name: '@deepseek-ai/dsh-computer-use'",
      '    - id: community-desktop.experimental.computer-use-provider',
      "      name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'",
    ].join('\n'),
  },
  'computer-use-mcp': {
    owner: 'computer-use',
    yaml: [
      '- insert:',
      '    - id: community-desktop.experimental.computer-use',
      "      name: '@deepseek-ai/dsh-computer-use'",
      '    - id: community-desktop.experimental.computer-use-provider',
      "      name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp'",
      '      config:',
      '        command: cua-driver',
      '        args: [mcp]',
    ].join('\n'),
  },
} as const satisfies Record<Exclude<ExperimentalCapabilityRecipe, 'browser-use-playwright-visible' | 'browser-use-devtools-visible'>, Recipe>

function resolveRecipe(recipeId: ExperimentalCapabilityRecipe, discovery: ChromiumDiscoveryOptions): Recipe {
  if (recipeId === 'browser-use-playwright-visible') {
    return browserRecipe('@deepseek-ai/dsh-experimental-browser-use-playwright-mcp', discovery)
  }
  if (recipeId === 'browser-use-devtools-visible') {
    return browserRecipe('@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp', discovery)
  }
  const recipe = (RECIPES as Partial<Record<string, Recipe>>)[recipeId]
  if (recipe === undefined) throw new Error('dsh: unsupported experimental capability recipe')
  return recipe
}

interface OwnedBlock {
  readonly from: number
  readonly through: number
}

function ownedBlock(text: string, owner: Recipe['owner']): OwnedBlock | undefined {
  const start = `# BEGIN community-desktop:${owner}`
  const end = `# END community-desktop:${owner}`
  const starts = [...text.matchAll(new RegExp(`^${start}\\r?$`, 'gmu'))]
  const ends = [...text.matchAll(new RegExp(`^${end}\\r?$`, 'gmu'))]
  const malformed = (): never => { throw new Error(`dsh: malformed community Desktop ${owner} composition block`) }
  if (starts.length !== ends.length || starts.length > 1
    || text.split(start).length - 1 !== starts.length
    || text.split(end).length - 1 !== ends.length) malformed()
  if (starts.length === 0) return undefined
  const begin = starts[0]
  const finish = ends[0]
  if (begin === undefined || finish === undefined) return malformed()
  if (finish.index <= begin.index + begin[0].length) return malformed()
  return { from: begin.index, through: finish.index + finish[0].length }
}

function replaceOwnedBlock(text: string, recipe: Recipe): string {
  const start = `# BEGIN community-desktop:${recipe.owner}`
  const end = `# END community-desktop:${recipe.owner}`
  const span = ownedBlock(text, recipe.owner)
  const block = `${start}\n${recipe.yaml}\n${end}`
  if (span === undefined) {
    const base = text.replace(/(?:^|\n)\s*\[\]\s*$/u, '').trimEnd()
    return `${base}${base === '' ? '' : '\n\n'}${block}\n`
  }
  return `${text.slice(0, span.from)}${block}${text.slice(span.through)}`
}

function removeOwnedBlock(text: string, owner: Recipe['owner']): string {
  const span = ownedBlock(text, owner)
  if (span === undefined) return text
  const before = text.slice(0, span.from).replace(/\r?\n$/u, '')
  const after = text.slice(span.through).replace(/^\r?\n/u, '')
  const retained = `${before}${before !== '' && after !== '' ? '\n' : ''}${after}`.trimEnd()
  const active = retained.replace(/^\s*#.*$/gmu, '').trim()
  return `${retained}${active === '' ? `${retained === '' ? '' : '\n'}[]` : ''}\n`
}

function writeAtomic(filename: string, content: string): void {
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
  const temporary = `${filename}.${randomUUID()}.tmp`
  const descriptor = openSync(temporary, 'wx', 0o600)
  let open = true
  try {
    writeFileSync(descriptor, content)
    fsyncSync(descriptor)
    closeSync(descriptor)
    open = false
    loadOptionalPatches('dsh', temporary)
    renameSync(temporary, filename)
  } catch (error) {
    if (open) closeSync(descriptor)
    rmSync(temporary, { force: true })
    throw error
  }
}

/**
 * Replace only a community-owned capability block while preserving unrelated user YAML and comments.
 * @param profile - Profile whose patch receives the capability block.
 * @param recipeId - Closed Desktop recipe to compose.
 * @param browserDiscovery - Optional browser observations used by launch recipes.
 * @returns Whether the profile patch changed.
 */
export function configureExperimentalCapability(
  profile: string,
  recipeId: ExperimentalCapabilityRecipe,
  browserDiscovery: ChromiumDiscoveryOptions = {},
): boolean {
  const recipe = resolveRecipe(recipeId, browserDiscovery)
  const filename = join(resolveProfileDir(profile), 'cordis.patch.yml')
  const text = existsSync(filename) ? readFileSync(filename, 'utf8') : '[]\n'
  if (existsSync(filename)) loadOptionalPatches('dsh', filename)
  const after = replaceOwnedBlock(text, recipe)
  if (after === text) return false
  writeAtomic(filename, after)
  return true
}

/**
 * Select one official Computer Use provider, or remove only its community-owned block.
 * Desktop callers run this through the Profile mutation transaction and restart after tasks settle.
 * The author-style provider stays unavailable until it is a loadable Cordis plugin.
 * @param profile - Profile whose patch owns the single Computer Use block.
 * @param backend - Closed provider choice or `off`.
 * @returns Whether the Profile patch changed.
 */
export function setComputerUseBackend(profile: string, backend: ComputerUseBackendSelection): boolean {
  if (backend === 'official-native') return configureExperimentalCapability(profile, 'computer-use-native')
  if (backend === 'official-mcp') return configureExperimentalCapability(profile, 'computer-use-mcp')
  // Keep a runtime guard for untyped CLI or IPC callers even though TypeScript narrows the union here.
  const selected: unknown = backend
  if (selected !== 'off') throw new Error('dsh: unsupported Computer Use backend')
  const filename = join(resolveProfileDir(profile), 'cordis.patch.yml')
  if (!existsSync(filename)) return false
  const text = readFileSync(filename, 'utf8')
  loadOptionalPatches('dsh', filename)
  const after = removeOwnedBlock(text, 'computer-use')
  if (after === text) return false
  writeAtomic(filename, after)
  return true
}
