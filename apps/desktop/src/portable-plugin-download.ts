/** Download an exact published package archive on the exporting computer. */

import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { valid } from 'semver'
import { inspectImportedPluginArchive } from './imported-plugin-local-source.ts'

const PACKAGE_NAME = /^(?:@[^/@\s]+\/[^/@\s]+|[^/@\s]+)$/u
const MAX_METADATA_BYTES = 1024 * 1024
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024

export interface DownloadedPortablePluginArchive {
  readonly archive: string
  cleanup(): Promise<void>
}

export type PortablePluginFetch = (url: URL, init: RequestInit) => Promise<Response>

function registryUrl(value: string): URL {
  const url = new URL(value)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new TypeError('desktop: portable plugin registry must be public HTTPS without credentials')
  }
  return url
}

function permittedOrigins(registry: URL): ReadonlySet<string> {
  return new Set(registry.hostname === 'registry.npmmirror.com'
    ? [registry.origin, 'https://cdn.npmmirror.com'] : [registry.origin])
}

async function fetchTrustedOrigins(url: URL, origins: ReadonlySet<string>, request: PortablePluginFetch): Promise<Response> {
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!origins.has(url.origin) || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
      throw new Error('desktop: plugin archive redirected outside its registry')
    }
    const response = await request(url, { redirect: 'manual', signal: AbortSignal.timeout(60_000) })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (location === null) throw new Error('desktop: plugin registry redirect has no location')
    url = new URL(location, url)
  }
  throw new Error('desktop: plugin registry redirected too many times')
}

async function boundedMetadata(response: Response): Promise<unknown> {
  if (!response.ok || response.body === null) throw new Error(`desktop: plugin registry metadata failed: ${response.status}`)
  const declared = Number(response.headers.get('content-length'))
  if (declared > MAX_METADATA_BYTES) throw new Error('desktop: plugin registry metadata is too large')
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.byteLength
    if (bytes > MAX_METADATA_BYTES) throw new Error('desktop: plugin registry metadata is too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function packageDistribution(value: unknown, name: string, version: string, registry: URL): { tarball: URL; integrity: Buffer } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('desktop: plugin registry returned invalid package metadata')
  }
  const metadata = value as { name?: unknown; version?: unknown; dist?: { tarball?: unknown; integrity?: unknown } }
  if (metadata.name !== name || metadata.version !== version || typeof metadata.dist?.tarball !== 'string'
    || typeof metadata.dist.integrity !== 'string') {
    throw new Error('desktop: plugin registry package identity or integrity is missing')
  }
  const tarball = new URL(metadata.dist.tarball)
  if (tarball.origin !== registry.origin || tarball.username !== '' || tarball.password !== ''
    || tarball.search !== '' || tarball.hash !== '') {
    throw new Error('desktop: plugin archive must come from the selected registry')
  }
  const match = /^sha512-([A-Za-z0-9+/]{86}==)$/u.exec(metadata.dist.integrity)
  if (match?.[1] === undefined) throw new Error('desktop: plugin archive requires a SHA-512 integrity value')
  const integrity = Buffer.from(match[1], 'base64')
  if (integrity.length !== 64) throw new Error('desktop: plugin archive integrity is invalid')
  return { tarball, integrity }
}

/** Download with strict size, source, package identity and registry SRI checks. */
export async function downloadPortablePluginArchive(
  registry: string,
  packageName: string,
  version: string,
  request: PortablePluginFetch = fetch,
): Promise<DownloadedPortablePluginArchive> {
  if (!PACKAGE_NAME.test(packageName) || valid(version) !== version) {
    throw new TypeError('desktop: invalid portable plugin package identity')
  }
  const base = registryUrl(registry)
  const origins = permittedOrigins(base)
  const metadataUrl = new URL(`${base.pathname.replace(/\/?$/u, '/')}${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`, base.origin)
  const distribution = packageDistribution(
    await boundedMetadata(await fetchTrustedOrigins(metadataUrl, origins, request)), packageName, version, base,
  )
  const directory = await mkdtemp(join(tmpdir(), 'dsh-portable-plugin-download-'))
  const archive = join(directory, 'package.tgz')
  try {
    const response = await fetchTrustedOrigins(distribution.tarball, origins, request)
    if (!response.ok || response.body === null) throw new Error(`desktop: plugin archive download failed: ${response.status}`)
    if (Number(response.headers.get('content-length')) > MAX_ARCHIVE_BYTES) {
      throw new Error('desktop: plugin archive exceeds 200 MiB')
    }
    const handle = await open(archive, 'wx', 0o600)
    const hash = createHash('sha512')
    let bytes = 0
    try {
      for await (const chunk of response.body) {
        bytes += chunk.byteLength
        if (bytes > MAX_ARCHIVE_BYTES) throw new Error('desktop: plugin archive exceeds 200 MiB')
        hash.update(chunk)
        await handle.writeFile(chunk)
      }
    } finally {
      await handle.close()
    }
    if (!timingSafeEqual(hash.digest(), distribution.integrity)) {
      throw new Error('desktop: plugin archive failed registry integrity check')
    }
    const manifest = await inspectImportedPluginArchive(archive, packageName)
    if (manifest.version !== version) throw new Error('desktop: plugin archive version differs from registry metadata')
    return { archive, cleanup: () => rm(directory, { recursive: true, force: true }) }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
