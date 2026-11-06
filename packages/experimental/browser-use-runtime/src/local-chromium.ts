/** Discover an existing Chrome or Chromium executable without installing a browser. */
import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, win32 } from 'node:path'

/**
 * List supported browser locations and PATH candidates without executing programs.
 * @param platform Runtime operating system.
 * @param environment Runtime environment used for standard installation locations and PATH.
 * @param home Runtime user's home directory.
 * @returns Ordered local Chrome and Chromium candidates.
 */
export function localChromiumCandidates(platform: string, environment: NodeJS.ProcessEnv, home: string): string[] {
  const paths: string[] = []
  if (platform === 'darwin') {
    for (const root of ['/Applications', join(home, 'Applications')]) {
      paths.push(join(root, 'Google Chrome.app/Contents/MacOS/Google Chrome'), join(root, 'Chromium.app/Contents/MacOS/Chromium'))
    }
  } else if (platform === 'win32') {
    for (const root of [environment.LOCALAPPDATA, environment.ProgramFiles, environment['ProgramFiles(x86)']]) {
      if (root) paths.push(win32.join(root, 'Google/Chrome/Application/chrome.exe'), win32.join(root, 'Chromium/Application/chrome.exe'))
    }
  } else {
    paths.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium')
  }
  for (const root of (environment.PATH ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean)) {
    for (const name of platform === 'win32' ? ['chrome.exe', 'chromium.exe'] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      paths.push(platform === 'win32' ? win32.join(root, name) : join(root, name))
    }
  }
  return [...new Set(paths)]
}

/** Host observations used by CLI discovery and isolated platform checks. */
export interface LocalChromiumDiscovery {
  readonly platform?: NodeJS.Platform
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly home?: string
  readonly isExecutable?: (path: string) => boolean
}

/**
 * Require an existing local browser; never fall back to downloading Chromium.
 * @param executablePath Explicit browser location, or undefined for standard discovery.
 * @param options Host filesystem and environment observations.
 * @returns An accessible executable Chrome or Chromium file.
 * @throws When an explicit executable is invalid or no local browser can be found.
 */
export function resolveLocalChromiumExecutable(executablePath?: string, options: LocalChromiumDiscovery = {}): string {
  const platform = options.platform ?? process.platform
  const environment = options.env ?? process.env
  const candidates = executablePath === undefined
    ? [...[environment.CHROME_PATH, environment.CHROMIUM_PATH].filter((path): path is string => Boolean(path)),
      ...localChromiumCandidates(platform, environment, options.home ?? environment.HOME ?? homedir())] : [executablePath]
  for (const candidate of candidates) {
    if (!(platform === 'win32' ? win32.isAbsolute(candidate) : isAbsolute(candidate))) continue
    if (options.isExecutable !== undefined) {
      if (options.isExecutable(candidate)) return candidate
      continue
    }
    try {
      if (!statSync(candidate).isFile()) continue
      accessSync(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK)
      return candidate
    } catch (_error) {
      // Unavailable locations are skipped; explicit paths never fall back to a different browser.
    }
  }
  throw new Error(executablePath === undefined
    ? 'Chrome or Chromium was not found. Install Chrome or Chromium, then enable Browser Use again. No browser will be downloaded automatically.'
    : `Browser executable is unavailable: ${executablePath}. Select an installed Chrome or Chromium executable.`)
}
