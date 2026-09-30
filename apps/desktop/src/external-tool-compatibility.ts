/** Signed remote compatibility lookup with an exact embedded fallback. */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { verify } from 'sigstore'
import {
  EMBEDDED_EXTERNAL_TOOL_COMPATIBILITY,
  parseExternalToolCompatibilityManifest,
  resolveExternalToolCoordinate,
  type DesktopExternalToolId,
  type ExternalToolCompatibilityManifest,
  type ExternalToolInstallResolution,
} from './external-tool-compatibility-manifest.ts'

const BUNDLE_NAME = 'external-tools-compatibility.v2.sigstore.json'
const METADATA_BASE = 'https://flaqai.github.io/open-deepseek-harness-desktop/metadata/external-tools/v2'
const SIGNING_IDENTITY = 'https://github.com/flaqai/open-deepseek-harness-desktop/.github/workflows/external-tool-compatibility.yml@refs/heads/master'
const SIGNING_ISSUER = 'https://token.actions.githubusercontent.com'
const MAX_DOCUMENT_BYTES = 1024 * 1024
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000

interface InTotoStatement {
  readonly _type?: unknown
  readonly subject?: readonly { readonly name?: unknown; readonly digest?: { readonly sha256?: unknown } }[]
}

interface SigstoreBundleEnvelope {
  readonly dsseEnvelope?: { readonly payload?: unknown; readonly payloadType?: unknown }
}

export interface ExternalToolCompatibilityManagerOptions {
  readonly cacheDirectory: string
  readonly desktopVersion: string
  readonly now?: () => Date
  readonly fetch?: typeof fetch
  readonly verifyBundle?: (bundle: unknown, cacheDirectory: string) => Promise<void>
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function parseStatement(bundle: unknown): InTotoStatement {
  if (bundle === null || typeof bundle !== 'object') throw new TypeError('desktop: invalid Sigstore bundle')
  const envelope = (bundle as SigstoreBundleEnvelope).dsseEnvelope
  if (envelope === undefined || typeof envelope.payload !== 'string'
    || envelope.payloadType !== 'application/vnd.in-toto+json') {
    throw new TypeError('desktop: compatibility attestation must contain an in-toto statement')
  }
  return JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8')) as InTotoStatement
}

function manifestName(desktopVersion: string): string {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(desktopVersion)) {
    throw new TypeError('desktop: invalid desktop version for external-tool compatibility lookup')
  }
  return `external-tools-compatibility-${desktopVersion}.v2.json`
}

function assertAttestedManifest(bundle: unknown, expectedName: string, manifestBytes: Uint8Array): void {
  const statement = parseStatement(bundle)
  if (statement._type !== 'https://in-toto.io/Statement/v1') {
    throw new TypeError('desktop: compatibility attestation has an unsupported statement type')
  }
  const expectedDigest = sha256(manifestBytes)
  const match = statement.subject?.some(subject => (
    subject.name === expectedName && subject.digest?.sha256 === expectedDigest
  )) ?? false
  if (!match) throw new TypeError('desktop: compatibility attestation does not cover the manifest digest')
}

async function defaultVerifyBundle(bundle: unknown, cacheDirectory: string): Promise<void> {
  await verify(bundle as Parameters<typeof verify>[0], {
    certificateIssuer: SIGNING_ISSUER,
    certificateIdentityURI: SIGNING_IDENTITY,
    tufCachePath: join(cacheDirectory, 'tuf'),
    timeout: 5000,
    retry: 1,
  })
}

async function readLimited(response: Response): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`desktop: compatibility download failed with HTTP ${response.status}`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) {
    throw new Error('desktop: compatibility document exceeds the size limit')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error('desktop: compatibility document exceeds the size limit')
  return bytes
}

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, bytes, { mode: 0o600 })
  await rename(temporary, path)
}

/** Refreshes signed pins per install request; overlapping requests share one lookup. */
export class ExternalToolCompatibilityManager {
  private readonly options: ExternalToolCompatibilityManagerOptions
  private readonly embedded = parseExternalToolCompatibilityManifest(EMBEDDED_EXTERNAL_TOOL_COMPATIBILITY)
  private refreshed: Promise<{ manifest: ExternalToolCompatibilityManifest; source: 'remote' | 'cache' } | undefined> | undefined

  constructor(options: ExternalToolCompatibilityManagerOptions) {
    this.options = options
  }

  async resolve(toolId: DesktopExternalToolId): Promise<ExternalToolInstallResolution> {
    const lookup = this.refreshed ??= this.loadSigned()
    try {
      const signed = await lookup
      if (signed !== undefined) return resolveExternalToolCoordinate(signed.manifest, toolId, signed.source)
      return resolveExternalToolCoordinate(this.embedded, toolId, 'embedded')
    } finally {
      if (this.refreshed === lookup) this.refreshed = undefined
    }
  }

  private assertCompatible(manifest: ExternalToolCompatibilityManifest): void {
    const now = (this.options.now ?? (() => new Date()))().getTime()
    if (Date.parse(manifest.issuedAt) > now + MAX_FUTURE_SKEW_MS || Date.parse(manifest.expiresAt) <= now) {
      throw new Error('desktop: signed external-tool compatibility manifest is expired or not yet valid')
    }
    if (this.options.desktopVersion !== manifest.desktopVersion) {
      throw new Error('desktop: signed external-tool compatibility manifest does not support this desktop version')
    }
    if (JSON.stringify(manifest) !== JSON.stringify(this.embedded)) {
      throw new Error('desktop: signed external-tool compatibility manifest differs from this installer release')
    }
  }

  private async verifyDocuments(
    manifestBytes: Uint8Array,
    bundleBytes: Uint8Array,
  ): Promise<ExternalToolCompatibilityManifest> {
    const bundle: unknown = JSON.parse(Buffer.from(bundleBytes).toString('utf8'))
    await (this.options.verifyBundle ?? defaultVerifyBundle)(bundle, this.options.cacheDirectory)
    assertAttestedManifest(bundle, manifestName(this.options.desktopVersion), manifestBytes)
    const manifest = parseExternalToolCompatibilityManifest(
      JSON.parse(Buffer.from(manifestBytes).toString('utf8')),
    )
    this.assertCompatible(manifest)
    return manifest
  }

  private async loadSigned(): Promise<{ manifest: ExternalToolCompatibilityManifest; source: 'remote' | 'cache' } | undefined> {
    const name = manifestName(this.options.desktopVersion)
    let cached: ExternalToolCompatibilityManifest | undefined
    try {
      const [manifestBytes, bundleBytes] = await Promise.all([
        readFile(join(this.options.cacheDirectory, name)),
        readFile(join(this.options.cacheDirectory, BUNDLE_NAME)),
      ])
      cached = await this.verifyDocuments(manifestBytes, bundleBytes)
    } catch (error) {
      console.warn('desktop: signed external-tool compatibility cache is unavailable', error)
    }
    try {
      const fetcher = this.options.fetch ?? globalThis.fetch
      const controller = new AbortController()
      const timer = setTimeout(() => { controller.abort() }, 6000)
      try {
        const [manifestResponse, bundleResponse] = await Promise.all([
          fetcher(`${METADATA_BASE}/${encodeURIComponent(name)}`, { signal: controller.signal, redirect: 'follow' }),
          fetcher(`${METADATA_BASE}/${BUNDLE_NAME}`, { signal: controller.signal, redirect: 'follow' }),
        ])
        const [manifestBytes, bundleBytes] = await Promise.all([
          readLimited(manifestResponse),
          readLimited(bundleResponse),
        ])
        const manifest = await this.verifyDocuments(manifestBytes, bundleBytes)
        await Promise.all([
          atomicWrite(join(this.options.cacheDirectory, name), manifestBytes),
          atomicWrite(join(this.options.cacheDirectory, BUNDLE_NAME), bundleBytes),
        ])
        return { manifest, source: 'remote' }
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      console.warn('desktop: signed external-tool compatibility refresh failed', error)
    }
    return cached === undefined ? undefined : { manifest: cached, source: 'cache' }
  }
}
