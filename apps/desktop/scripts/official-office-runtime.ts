/** Resolve and verify the official platform Office engine distributed by npm. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { selectOfficeEngine } from '../../../scripts/libreoffice-engine.ts'
import { curlProxyArguments } from './release-download-route.ts'

export interface OfficialOfficeTarget {
  readonly release: 'win32-x64' | 'darwin-arm64' | 'darwin-x64' | 'linux-x64'
  readonly platform: NodeJS.Platform
  readonly arch: string
}

export interface OfficialOfficeArtifact {
  readonly source: 'npm'
  readonly fileName: string
  readonly size: number
  readonly integrity: string
  readonly payloadDigest: string
  readonly enginePackage: string
  readonly engineVersion: string
  readonly url: string
}

function download(url: string, destination: string): void {
  try {
    execFileSync('curl', [
      '--fail', '--silent', '--show-error', '--location', '--output', destination,
      ...curlProxyArguments(), url,
    ], { stdio: 'inherit', timeout: 15 * 60_000 })
  } catch (error) {
    rmSync(destination, { force: true })
    throw new Error(`workspace runtime: official Office engine download failed for ${url}`, { cause: error })
  }
}

function contentLength(url: string, cache: string): number {
  const probe = join(cache, `.size-probe-${process.pid}`)
  try {
    const output = execFileSync('curl', [
      '--fail', '--silent', '--show-error', '--location', '--range', '0-0', '--dump-header', '-', '--output', probe,
      ...curlProxyArguments(), url,
    ], { encoding: 'utf8', timeout: 60_000 })
    const values = [...output.matchAll(/^content-range:\s*bytes\s+0-0\/(\d+)\s*$/gimu)]
    const size = Number(values.at(-1)?.[1])
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error('response has no valid Content-Range')
    return size
  } catch (error) {
    throw new Error(`workspace runtime: Office engine size probe failed for ${url}`, { cause: error })
  } finally {
    rmSync(probe, { force: true })
  }
}

/** Return signed-catalog metadata for the official npm tarball without repackaging it. */
export function officialOfficeArtifact(target: OfficialOfficeTarget, root: string, cache: string): OfficialOfficeArtifact {
  const require = createRequire(join(root, 'packages', 'document', 'office-kit', 'package.json'))
  const kitManifest = require.resolve('@deepseek-ai/libreoffice-kit/package.json')
  const kit = JSON.parse(readFileSync(kitManifest, 'utf8')) as {
    version: string
    optionalDependencies?: Record<string, string>
  }
  const enginePackage = `@deepseek-ai/libreoffice-kit-${selectOfficeEngine(kit, target)}`
  if (kit.optionalDependencies?.[enginePackage] !== kit.version) {
    throw new Error(`workspace runtime: Office engine identity mismatch for ${enginePackage}`)
  }
  const leaf = enginePackage.slice('@deepseek-ai/'.length)
  mkdirSync(cache, { recursive: true })
  const metadataFile = join(cache, `${leaf}-${kit.version}.json`)
  download(`https://registry.npmjs.org/${encodeURIComponent(enginePackage)}/${kit.version}`, metadataFile)
  const metadata = JSON.parse(readFileSync(metadataFile, 'utf8')) as {
    name?: unknown
    version?: unknown
    dist?: { tarball?: unknown; integrity?: unknown }
  }
  if (metadata.name !== enginePackage || metadata.version !== kit.version
    || typeof metadata.dist?.tarball !== 'string' || typeof metadata.dist.integrity !== 'string') {
    throw new Error(`workspace runtime: invalid npm metadata for ${enginePackage}@${kit.version}`)
  }
  const url = new URL(metadata.dist.tarball)
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.username !== '' || url.password !== '') {
    throw new Error(`workspace runtime: invalid npm tarball URL for ${enginePackage}@${kit.version}`)
  }
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(metadata.dist.integrity)) {
    throw new Error(`workspace runtime: invalid npm integrity for ${enginePackage}@${kit.version}`)
  }
  const fileName = `${leaf}-${kit.version}.tgz`
  const integrity = metadata.dist.integrity
  const size = contentLength(url.href, cache)
  const payloadDigest = createHash('sha256').update(JSON.stringify({
    format: 2,
    target: target.release,
    enginePackage,
    engineVersion: kit.version,
    integrity,
  })).digest('hex')
  return {
    source: 'npm', fileName, size, integrity, payloadDigest,
    enginePackage, engineVersion: kit.version, url: url.href,
  }
}
