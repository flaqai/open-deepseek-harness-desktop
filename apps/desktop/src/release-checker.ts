/** GitHub Release discovery without downloading or installing application files. */

const RELEASES_ENDPOINT = 'https://api.github.com/repos/flaqai/open-deepseek-harness-desktop/releases?per_page=30'
const RELEASE_URL_PREFIX = 'https://github.com/flaqai/open-deepseek-harness-desktop/releases/'

/** Renderer-visible release check status. */
export type DesktopReleaseStatus =
  | { phase: 'unsupported' }
  | { phase: 'idle'; currentVersion: string }
  | { phase: 'checking'; currentVersion: string }
  | { phase: 'current'; currentVersion: string }
  | { phase: 'available'; currentVersion: string; latestVersion: string; publishedAt: string; releaseUrl: string }
  | { phase: 'error'; currentVersion: string; message: string }

interface GitHubRelease {
  draft?: unknown
  prerelease?: unknown
  tag_name?: unknown
  html_url?: unknown
  published_at?: unknown
}

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: readonly (number | string)[]
}

function parseVersion(value: string): ParsedVersion | undefined {
  const normalized = value.replace(/^dsh-v/u, '').replace(/^v/u, '')
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(normalized)
  if (match === null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.').map(part => /^\d+$/u.test(part) ? Number(part) : part) ?? [],
  }
}

function comparePrerelease(left: ParsedVersion['prerelease'], right: ParsedVersion['prerelease']): number {
  if (left.length === 0 || right.length === 0) return left.length === right.length ? 0 : left.length === 0 ? 1 : -1
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1
    if (a === b) continue
    if (typeof a === 'number' && typeof b === 'number') return a > b ? 1 : -1
    if (typeof a === 'number') return -1
    if (typeof b === 'number') return 1
    return a > b ? 1 : -1
  }
  return 0
}

/** Compare two accepted desktop semantic versions. */
export function compareDesktopVersions(left: string, right: string): number | undefined {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === undefined || b === undefined) return undefined
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1
  }
  return comparePrerelease(a.prerelease, b.prerelease)
}

/** Whether a Release page belongs to the configured FLAQ repository. */
export function isAllowedReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.href.startsWith(RELEASE_URL_PREFIX)
  } catch {
    return false
  }
}

/** Select the newest Release allowed by the installed version's channel. */
export function selectRelease(currentVersion: string, releases: readonly GitHubRelease[]): DesktopReleaseStatus {
  const current = parseVersion(currentVersion)
  if (current === undefined) return { phase: 'error', currentVersion, message: 'The installed version is not valid semantic version data.' }
  const allowPrerelease = current.prerelease.length > 0
  const currentChannel = typeof current.prerelease[0] === 'string' ? current.prerelease[0] : undefined
  const candidates = releases.flatMap((release) => {
    if (release.draft === true || (!allowPrerelease && release.prerelease === true)) return []
    if (typeof release.tag_name !== 'string' || typeof release.html_url !== 'string' || typeof release.published_at !== 'string') return []
    const parsed = parseVersion(release.tag_name)
    if (!isAllowedReleaseUrl(release.html_url) || parsed === undefined) return []
    const candidateChannel = typeof parsed.prerelease[0] === 'string' ? parsed.prerelease[0] : undefined
    if (parsed.prerelease.length > 0 && candidateChannel !== currentChannel) return []
    return [{ version: release.tag_name.replace(/^dsh-v/u, '').replace(/^v/u, ''), url: release.html_url, publishedAt: release.published_at }]
  }).sort((a, b) => compareDesktopVersions(b.version, a.version) ?? 0)
  const newest = candidates[0]
  if (newest === undefined || (compareDesktopVersions(newest.version, currentVersion) ?? 0) <= 0) {
    return { phase: 'current', currentVersion }
  }
  return {
    phase: 'available',
    currentVersion,
    latestVersion: newest.version,
    publishedAt: newest.publishedAt,
    releaseUrl: newest.url,
  }
}

/** Stateful Release checker with callback-contained status publication. */
export class DesktopReleaseChecker {
  #status: DesktopReleaseStatus
  #running: Promise<DesktopReleaseStatus> | undefined
  readonly #listeners = new Set<(status: DesktopReleaseStatus) => void>()

  constructor(
    readonly currentVersion: string,
    readonly fetchReleases: () => Promise<readonly GitHubRelease[]> = async () => {
      const response = await fetch(RELEASES_ENDPOINT, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DeepSeek-Harness-Desktop' },
      })
      if (!response.ok) throw new Error(`GitHub Releases returned HTTP ${response.status}`)
      const body: unknown = await response.json()
      if (!Array.isArray(body)) throw new Error('GitHub Releases returned an invalid response')
      return body as GitHubRelease[]
    },
  ) {
    this.#status = { phase: 'idle', currentVersion }
  }

  get status(): DesktopReleaseStatus { return this.#status }

  subscribe(listener: (status: DesktopReleaseStatus) => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  #publish(status: DesktopReleaseStatus): DesktopReleaseStatus {
    this.#status = status
    for (const listener of [...this.#listeners]) {
      try { listener(status) } catch (error) { console.error('desktop: release status listener failed', error) }
    }
    return status
  }

  check(): Promise<DesktopReleaseStatus> {
    if (this.#running !== undefined) return this.#running
    this.#publish({ phase: 'checking', currentVersion: this.currentVersion })
    this.#running = this.fetchReleases()
      .then(releases => this.#publish(selectRelease(this.currentVersion, releases)))
      .catch((error: unknown) => this.#publish({
        phase: 'error',
        currentVersion: this.currentVersion,
        message: error instanceof Error ? error.message : String(error),
      }))
      .finally(() => { this.#running = undefined })
    return this.#running
  }
}
