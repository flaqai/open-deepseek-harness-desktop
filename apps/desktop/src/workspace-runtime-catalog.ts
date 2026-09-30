/** Signed workspace-runtime release catalog with a verified last-known-good cache. */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { verify } from 'sigstore'
import { parseWorkspaceRuntimeManifest, type WorkspaceRuntimeManifest } from './workspace-runtime-manifest.ts'

const SIGNING_IDENTITY = 'https://github.com/flaqai/open-deepseek-harness-desktop/.github/workflows/workspace-runtime-release.yml@refs/heads/master'
const SIGNING_ISSUER = 'https://token.actions.githubusercontent.com'
const MAX_DOCUMENT_BYTES = 1024 * 1024

interface Statement {
  readonly _type?: unknown
  readonly subject?: readonly { readonly name?: unknown; readonly digest?: { readonly sha256?: unknown } }[]
}

interface Bundle {
  readonly dsseEnvelope?: { readonly payload?: unknown; readonly payloadType?: unknown }
}

class CatalogHttpError extends Error {
  constructor(readonly status: number) {
    super(`desktop: workspace-runtime catalog returned HTTP ${status}`)
  }
}

export interface WorkspaceRuntimeCatalogOptions {
  readonly cacheDirectory: string
  readonly desktopVersion: string
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
  readonly now?: () => Date
  readonly metadataBaseUrl?: string
  readonly metadataBaseUrls?: () => readonly string[]
  readonly development?: boolean
  readonly verifyBundle?: (bundle: unknown, cacheDirectory: string) => Promise<void>
}

function documentName(version: string, generation: 1 | 2): string {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new TypeError('desktop: invalid Desktop version for workspace-runtime catalog')
  }
  return `workspace-runtimes-${version}.v${generation}.json`
}

function bundleName(generation: 1 | 2): string { return `workspace-runtimes.v${generation}.sigstore.json` }

async function limited(response: Response): Promise<Uint8Array> {
  if (!response.ok) throw new CatalogHttpError(response.status)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) throw new Error('desktop: workspace-runtime catalog exceeds its size limit')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error('desktop: workspace-runtime catalog exceeds its size limit')
  return bytes
}

function attested(bundle: unknown, name: string, bytes: Uint8Array): void {
  if (bundle === null || typeof bundle !== 'object') throw new TypeError('desktop: invalid workspace-runtime Sigstore bundle')
  const envelope = (bundle as Bundle).dsseEnvelope
  if (typeof envelope?.payload !== 'string' || envelope.payloadType !== 'application/vnd.in-toto+json') {
    throw new TypeError('desktop: workspace-runtime attestation must contain an in-toto statement')
  }
  const statement = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8')) as Statement
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (statement._type !== 'https://in-toto.io/Statement/v1'
    || !(statement.subject?.some(subject => subject.name === name && subject.digest?.sha256 === digest) ?? false)) {
    throw new TypeError('desktop: workspace-runtime attestation does not cover the catalog digest')
  }
}

async function verifyBundle(bundle: unknown, cache: string): Promise<void> {
  await verify(bundle as Parameters<typeof verify>[0], {
    certificateIssuer: SIGNING_ISSUER,
    certificateIdentityURI: SIGNING_IDENTITY,
    tufCachePath: join(cache, 'tuf'), timeout: 5000, retry: 1,
  })
}

async function atomicWrite(path: string, value: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, value, { mode: 0o600 })
  await rename(temporary, path)
}

/** Loads only signed, current-version metadata; unsigned development overrides require an explicit development flag. */
export class WorkspaceRuntimeCatalog {
  readonly #options: WorkspaceRuntimeCatalogOptions
  #loading: Promise<WorkspaceRuntimeManifest> | undefined

  constructor(options: WorkspaceRuntimeCatalogOptions) { this.#options = options }

  load(): Promise<WorkspaceRuntimeManifest> {
    const loading = this.#loading ??= this.#load()
    return loading.finally(() => { if (this.#loading === loading) this.#loading = undefined })
  }

  async #load(): Promise<WorkspaceRuntimeManifest> {
    if (this.#options.metadataBaseUrl !== undefined && this.#options.development !== true) {
      throw new Error('desktop: workspace-runtime catalog override is allowed only in development mode')
    }
    const bases = this.#options.metadataBaseUrl === undefined
      ? this.#options.metadataBaseUrls?.() ?? []
      : [this.#options.metadataBaseUrl]
    if (bases.length === 0) throw new Error('desktop: workspace-runtime catalog has no download source')
    let cached: WorkspaceRuntimeManifest | undefined
    for (const generation of [2, 1] as const) try {
      const name = documentName(this.#options.desktopVersion, generation)
      cached = await this.#verify(
        await readFile(join(this.#options.cacheDirectory, name)),
        await readFile(join(this.#options.cacheDirectory, bundleName(generation))),
        name,
      )
      break
    } catch (error) {
      console.warn(`desktop: signed workspace-runtime v${generation} cache is unavailable`, error)
    }
    let remoteError: unknown
    for (const generation of [2, 1] as const) {
      let generationMissing = true
      const name = documentName(this.#options.desktopVersion, generation)
      const signatureName = bundleName(generation)
      for (const rawBase of bases) try {
        const base = rawBase.replace(/\/+$/u, '')
        const controller = new AbortController()
        const timeout = setTimeout(() => { controller.abort() }, 10_000)
        try {
          const [manifestResponse, bundleResponse] = await Promise.all([
            this.#options.fetch(`${base}/${encodeURIComponent(name)}`, { signal: controller.signal, redirect: 'follow' }),
            this.#options.fetch(`${base}/${encodeURIComponent(signatureName)}`, { signal: controller.signal, redirect: 'follow' }),
          ])
          const [manifestBytes, bundleBytes] = await Promise.all([limited(manifestResponse), limited(bundleResponse)])
          const manifest = await this.#verify(manifestBytes, bundleBytes, name)
          await Promise.all([
            atomicWrite(join(this.#options.cacheDirectory, name), manifestBytes),
            atomicWrite(join(this.#options.cacheDirectory, signatureName), bundleBytes),
          ])
          return manifest
        } finally { clearTimeout(timeout) }
      } catch (error) {
        remoteError = error
        if (!(error instanceof CatalogHttpError) || error.status !== 404) generationMissing = false
      }
      if (!generationMissing) break
    }
    if (cached !== undefined) return cached
    throw remoteError
  }

  async #verify(manifestBytes: Uint8Array, bundleBytes: Uint8Array, name: string): Promise<WorkspaceRuntimeManifest> {
    const bundle: unknown = JSON.parse(Buffer.from(bundleBytes).toString('utf8'))
    await (this.#options.verifyBundle ?? verifyBundle)(bundle, this.#options.cacheDirectory)
    attested(bundle, name, manifestBytes)
    const manifest = parseWorkspaceRuntimeManifest(JSON.parse(Buffer.from(manifestBytes).toString('utf8')))
    const now = (this.#options.now ?? (() => new Date()))().getTime()
    if (manifest.desktopVersion !== this.#options.desktopVersion
      || Date.parse(manifest.issuedAt) > now + 10 * 60_000 || Date.parse(manifest.expiresAt) <= now) {
      throw new Error('desktop: workspace-runtime catalog is incompatible, expired, or not yet valid')
    }
    return manifest
  }
}
