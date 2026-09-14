/** Rebase pnpm-generated local locators without changing dependency versions or manifest specs. */
import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Relocate parsed pnpm metadata between a candidate and its active Profile.
 * Importer specifiers stay literal; generated local package IDs and workspace paths move together.
 * @param value - Parsed lockfile, modules metadata, or workspace state.
 * @param from - Profile directory used when pnpm generated this metadata.
 * @param to - Profile directory that will own the metadata.
 * @param candidateHome - Controlled candidate home whose copied local files map back to activeHome.
 * @param activeHome - Original Harness home.
 * @returns Equivalent metadata with location-dependent references rebased.
 */
export function relocateProfilePluginMetadata(
  value: unknown, from: string, to: string, candidateHome: string, activeHome: string,
): unknown {
  const physicalTo = existsSync(to) ? realpathSync(to) : to
  const physicalCandidate = existsSync(candidateHome) ? realpathSync(candidateHome) : candidateHome
  const physicalActive = existsSync(activeHome) ? realpathSync(activeHome) : activeHome
  const relocate = (text: string): string => {
    if (text === from || text.startsWith(`${from}${sep}`)) return to + text.slice(from.length)
    if (isAbsolute(text)) {
      const local = relative(candidateHome, text)
      if (local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local)) return resolve(activeHome, local)
    }
    const match = /^(.*?@)?(file|link):(.+)$/u.exec(text)
    if (match?.[3] === undefined || isAbsolute(match[3])) return text
    let path = match[3]
    let suffix = ''
    // Peer-context suffixes are part of package IDs, not part of the archive path.
    const peer = path.indexOf('(')
    if (peer >= 0 && !existsSync(resolve(from, path))) {
      suffix = path.slice(peer)
      path = path.slice(0, peer)
    }
    let target = resolve(from, path)
    if (existsSync(target)) target = realpathSync(target)
    const candidateRelative = relative(physicalCandidate, target)
    if (candidateRelative !== '..' && !candidateRelative.startsWith(`..${sep}`) && !isAbsolute(candidateRelative)) {
      target = resolve(physicalActive, candidateRelative)
    }
    const moved = relative(physicalTo, target).split(sep).join('/') || '.'
    return `${match[1] ?? ''}${match[2]}:${moved}${suffix}`
  }
  const visit = (input: unknown): unknown => {
    if (typeof input === 'string') return relocate(input)
    if (Array.isArray(input)) return input.map(visit)
    if (input === null || typeof input !== 'object') return input
    return Object.fromEntries(Object.entries(input).map(([key, child]) => [relocate(key), key === 'specifier' ? child : visit(child)]))
  }
  return visit(value)
}
