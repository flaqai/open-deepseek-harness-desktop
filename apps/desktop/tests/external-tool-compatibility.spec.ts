import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import manifestJson from '../external-tools/manifests/0.2.1-rc.2.1/external-tools-compatibility.v2.json'
import rc2ManifestJson from '../external-tools/manifests/0.2.1-rc.2/external-tools-compatibility.v2.json'
import alpha4ManifestJson from '../external-tools/manifests/0.2.1-alpha.4/external-tools-compatibility.v2.json'
import previousManifestJson from '../external-tools/manifests/0.2.1-alpha.3/external-tools-compatibility.v2.json'
import publishedManifestJson from '../external-tools/manifests/0.2.1-alpha.2/external-tools-compatibility.v2.json'
import { ExternalToolCompatibilityManager } from '../src/external-tool-compatibility.ts'
import { assertExternalToolPublishedProvider, assertExternalToolSourcePins } from '../scripts/external-tool-provider-compatibility.ts'
import {
  EMBEDDED_EXTERNAL_TOOL_COMPATIBILITY,
  parseExternalToolCompatibilityManifest,
  resolveExternalToolCoordinate,
} from '../src/external-tool-compatibility-manifest.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dsh-external-tools-'))
  temporaryDirectories.push(path)
  return path
}

function manifestBytes(value: unknown = manifestJson): Uint8Array {
  return Buffer.from(JSON.stringify(value))
}

function bundleBytes(
  bytes: Uint8Array,
  digest = createHash('sha256').update(bytes).digest('hex'),
  subjectName = `external-tools-compatibility-${manifestJson.desktopVersion}.v2.json`,
): Uint8Array {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: subjectName, digest: { sha256: digest } }],
    predicateType: ['https://slsa.dev', 'prove' + 'nance', 'v1'].join('/'),
    predicate: {},
  }
  return Buffer.from(JSON.stringify({
    dsseEnvelope: {
      payloadType: 'application/vnd.in-toto+json',
      payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
      signatures: [{}],
    },
  }))
}

function response(bytes: Uint8Array): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-length': String(bytes.byteLength) } })
}

describe('external tool compatibility', () => {
  it('separates the new Desktop identity from published alpha and rc.2 coordinates', () => {
    expect(manifestJson.desktopVersion).toBe('0.2.1-rc.2.1')
    expect(manifestJson.revision).toBe(20)
    expect(manifestJson.reviewedSourceVersion).toBe('0.2.1-rc.2')
    expect(manifestJson.issuedAt).toBe('2026-10-20T00:00:00.000Z')
    expect(manifestJson.expiresAt).toBe('2027-04-20T00:00:00.000Z')
    expect(EMBEDDED_EXTERNAL_TOOL_COMPATIBILITY).toEqual(manifestJson)
    expect(rc2ManifestJson.desktopVersion).toBe('0.2.1-rc.2')
    expect(rc2ManifestJson.revision).toBe(19)
    expect(manifestJson.tools).toEqual(rc2ManifestJson.tools)
    expect(publishedManifestJson.desktopVersion).toBe('0.2.1-alpha.2')
    expect(publishedManifestJson.reviewedSourceVersion).toBe('0.2.1-alpha.2')
    expect(previousManifestJson.desktopVersion).toBe('0.2.1-alpha.3')
    expect(previousManifestJson.reviewedSourceVersion).toBe('0.2.1-alpha.3')
    expect(alpha4ManifestJson.desktopVersion).toBe('0.2.1-alpha.4')
    expect(alpha4ManifestJson.reviewedSourceVersion).toBe('0.2.1-alpha.4')
    expect(alpha4ManifestJson.revision).toBe(18)
    for (const toolId of ['codex', 'claude-code'] as const) {
      expect(publishedManifestJson.tools[toolId].version).toBe('0.2.1-alpha.2')
      expect(previousManifestJson.tools[toolId].version).toBe('0.2.1-alpha.3')
      expect(alpha4ManifestJson.tools[toolId].version).toBe('0.2.1-alpha.4')
      expect(manifestJson.tools[toolId].runtimePackage).toEqual(alpha4ManifestJson.tools[toolId].runtimePackage)
    }
  })

  it('binds immutable provider reviews while retaining the current runtime dependency check', async () => {
    for (const toolId of ['codex', 'claude-code'] as const) {
      const provider = JSON.parse(await readFile(new URL(
        `../../../packages/subagent/subagent-${toolId}/package.json`, import.meta.url,
      ), 'utf8')) as { name: string; version: string; dependencies: Record<string, string> }
      const coordinate = manifestJson.tools[toolId]
      expect(() => { assertExternalToolSourcePins(parseExternalToolCompatibilityManifest(manifestJson), toolId, provider) }).not.toThrow()
      expect(manifestJson.reviewedSourceVersion).toBe(coordinate.version)
      expect(coordinate.runtimePackage.version).toBe(provider.dependencies[coordinate.runtimePackage.packageName])
    }
  })

  it('rejects incompatible published core requirements instead of treating unchanged runtimes as approval', () => {
    const manifest = parseExternalToolCompatibilityManifest(manifestJson)
    const coordinate = manifest.tools.codex
    const dependencies = { [coordinate.runtimePackage.packageName]: coordinate.runtimePackage.version }
    const provider = { name: coordinate.packageName, version: '0.2.1-rc.2', dependencies }
    const published = { name: coordinate.packageName, version: coordinate.version, dependencies,
      peerDependencies: { '@deepseek-ai/dsh-subagent': '0.2.1-alpha.3' } }
    expect(() => { assertExternalToolPublishedProvider(manifest, 'codex', provider, published) })
      .toThrow('does not accept current core 0.2.1-rc.2')
    expect(() => { assertExternalToolPublishedProvider(manifest, 'codex', provider, {
      ...published, peerDependencies: { '@deepseek-ai/dsh-subagent': '^0.2.1-alpha.3' },
    }) }).not.toThrow()
    expect(() => { assertExternalToolPublishedProvider(manifest, 'codex', provider, {
      ...published, engines: { dsh: '^0.2.1-alpha.3' },
    }) }).not.toThrow()
  })

  it('rejects source runtime drift and a review attached to a different pinned provider', () => {
    const manifest = parseExternalToolCompatibilityManifest(manifestJson)
    const coordinate = manifest.tools.codex
    const provider = { name: coordinate.packageName, version: '0.2.1-rc.2',
      dependencies: { [coordinate.runtimePackage.packageName]: '999.0.0' } }
    expect(() => { assertExternalToolSourcePins(manifest, 'codex', provider) }).toThrow('reviewed runtime must match')
    expect(() => { assertExternalToolSourcePins({ ...manifest, reviewedSourceVersion: '0.2.1-alpha.3' }, 'codex', provider) })
      .toThrow('review must identify its pinned provider source version')
  })

  it('rejects published runtime drift and absent or invalid DSH compatibility declarations', () => {
    const manifest = parseExternalToolCompatibilityManifest(manifestJson)
    const coordinate = manifest.tools.codex
    const dependencies = { [coordinate.runtimePackage.packageName]: coordinate.runtimePackage.version }
    const provider = { name: coordinate.packageName, version: '0.2.1-rc.2', dependencies }
    const published = { name: coordinate.packageName, version: coordinate.version, dependencies }
    expect(() => { assertExternalToolPublishedProvider(manifest, 'codex', provider, {
      ...published, dependencies: { [coordinate.runtimePackage.packageName]: '999.0.0' },
    }) }).toThrow('must depend on the reviewed runtime version')
    expect(() => { assertExternalToolPublishedProvider(manifest, 'codex', provider, published) })
      .toThrow('declares no DSH compatibility requirement')
    for (const range of ['', 'broken', 'workspace:*']) {
      expect(() => { assertExternalToolPublishedProvider(manifest, 'codex', provider, {
        ...published, engines: { dsh: range },
      }) }).toThrow('does not accept current core')
    }
  })

  it('retries online lookup after an earlier offline install request', async () => {
    const manifest = manifestBytes()
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))
    const manager = new ExternalToolCompatibilityManager({
      cacheDirectory: await temporaryDirectory(),
      desktopVersion: manifestJson.desktopVersion,
      now: () => new Date(manifestJson.issuedAt),
      fetch: fetchMock,
      verifyBundle: async () => {},
    })
    await expect(manager.resolve('codex')).resolves.toMatchObject({ source: 'embedded' })
    fetchMock.mockReset()
      .mockResolvedValueOnce(response(manifest))
      .mockResolvedValueOnce(response(bundleBytes(manifest)))
    await expect(manager.resolve('codex')).resolves.toMatchObject({ source: 'remote' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects changed coordinates for the same immutable desktop release', async () => {
    const changed = manifestBytes({
      ...manifestJson,
      revision: manifestJson.revision + 1,
      tools: {
        ...manifestJson.tools,
        codex: { ...manifestJson.tools.codex, version: '0.1.5-rc.3' },
      },
    })
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(changed))
      .mockResolvedValueOnce(response(bundleBytes(changed)))
    const manager = new ExternalToolCompatibilityManager({
      cacheDirectory: await temporaryDirectory(),
      desktopVersion: manifestJson.desktopVersion,
      now: () => new Date(manifestJson.issuedAt),
      fetch: fetchMock,
      verifyBundle: async () => {},
    })
    await expect(manager.resolve('codex')).resolves.toMatchObject({ version: '0.2.1-rc.2', source: 'embedded' })
  })

  it('shares an in-flight refresh across concurrent tool requests', async () => {
    const manifest = manifestBytes()
    let releaseBarrier: (() => void) | undefined
    let notifyStarted: (() => void) | undefined
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve })
    const started = new Promise<void>((resolve) => { notifyStarted = resolve })
    let arrivals = 0
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (++arrivals === 2) notifyStarted?.()
      await barrier
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return response(url.endsWith('.sigstore.json') ? bundleBytes(manifest) : manifest)
    })
    const manager = new ExternalToolCompatibilityManager({
      cacheDirectory: await temporaryDirectory(),
      desktopVersion: manifestJson.desktopVersion,
      now: () => new Date(manifestJson.issuedAt),
      fetch: fetchMock,
      verifyBundle: async () => {},
    })
    const codex = manager.resolve('codex')
    const claude = manager.resolve('claude-code')
    try {
      await started
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      releaseBarrier?.()
      await Promise.all([codex, claude])
    }
    await expect(codex).resolves.toMatchObject({ source: 'remote', toolId: 'codex' })
    await expect(claude).resolves.toMatchObject({ source: 'remote', toolId: 'claude-code' })
  })

  it('parses exact pins and never creates a floating package spec', () => {
    const manifest = parseExternalToolCompatibilityManifest(manifestJson)
    expect(resolveExternalToolCoordinate(manifest, 'codex', 'embedded')).toMatchObject({
      packageSpec: '@deepseek-ai/dsh-subagent-codex@0.2.1-rc.2',
      source: 'embedded',
    })
  })

  it('accepts a signed remote manifest whose attested digest matches', async () => {
    const cacheDirectory = await temporaryDirectory()
    const manifest = manifestBytes()
    const bundle = bundleBytes(manifest)
    const verifyBundle = vi.fn(async () => {})
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(manifest))
      .mockResolvedValueOnce(response(bundle))
    const manager = new ExternalToolCompatibilityManager({
      cacheDirectory,
      desktopVersion: manifestJson.desktopVersion,
      now: () => new Date(manifestJson.issuedAt),
      fetch: fetchMock,
      verifyBundle,
    })

    await expect(manager.resolve('claude-code')).resolves.toMatchObject({
      packageSpec: '@deepseek-ai/dsh-subagent-claude-code@0.2.1-rc.2',
      source: 'remote',
    })
    expect(verifyBundle).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenNthCalledWith(1,
      `https://flaqai.github.io/open-deepseek-harness-desktop/metadata/external-tools/v2/external-tools-compatibility-${manifestJson.desktopVersion}.v2.json`,
      expect.objectContaining({ redirect: 'follow' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      'https://flaqai.github.io/open-deepseek-harness-desktop/metadata/external-tools/v2/external-tools-compatibility.v2.sigstore.json',
      expect.objectContaining({ redirect: 'follow' }),
    )
    expect(await readFile(join(cacheDirectory, `external-tools-compatibility-${manifestJson.desktopVersion}.v2.json`))).toEqual(Buffer.from(manifest))
  })

  it('falls back to embedded pins when Pages is unavailable without querying a Release', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('Not Found', { status: 404 }))
    const manager = new ExternalToolCompatibilityManager({
      cacheDirectory: await temporaryDirectory(),
      desktopVersion: manifestJson.desktopVersion,
      now: () => new Date(manifestJson.issuedAt),
      fetch: fetchMock,
    })
    await expect(manager.resolve('codex')).resolves.toMatchObject({ source: 'embedded' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [input] of fetchMock.mock.calls) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      expect(url).toMatch(/^https:\/\/flaqai\.github\.io\//)
      expect(url).not.toContain('/releases/')
    }
  })

  it('rejects a mismatched attestation and falls back to embedded pins', async () => {
    const cacheDirectory = await temporaryDirectory()
    const manifest = manifestBytes()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(manifest))
      .mockResolvedValueOnce(response(bundleBytes(manifest, '0'.repeat(64))))
    const manager = new ExternalToolCompatibilityManager({
      cacheDirectory,
      desktopVersion: manifestJson.desktopVersion,
      now: () => new Date(manifestJson.issuedAt),
      fetch: fetchMock,
      verifyBundle: async () => {},
    })

    await expect(manager.resolve('codex')).resolves.toMatchObject({ source: 'embedded' })
  })

  it('uses a verified immutable cache when refresh is offline', async () => {
    const cacheDirectory = await temporaryDirectory()
    const manifest = manifestBytes()
    const first = new ExternalToolCompatibilityManager({
      cacheDirectory,
      desktopVersion: manifestJson.desktopVersion,
      now: () => new Date(manifestJson.issuedAt),
      fetch: vi.fn()
        .mockResolvedValueOnce(response(manifest))
        .mockResolvedValueOnce(response(bundleBytes(manifest))),
      verifyBundle: async () => {},
    })
    await expect(first.resolve('codex')).resolves.toMatchObject({ source: 'remote', revision: manifestJson.revision })

    const offline = new ExternalToolCompatibilityManager({
      cacheDirectory,
      desktopVersion: manifestJson.desktopVersion,
      now: () => new Date(manifestJson.issuedAt),
      fetch: vi.fn(async () => { throw new Error('offline') }),
      verifyBundle: async () => {},
    })
    await expect(offline.resolve('claude-code')).resolves.toMatchObject({ source: 'cache', revision: manifestJson.revision })
  })

  it('rejects a manifest for another prerelease on the same version line', async () => {
    const manifest = manifestBytes()
    const manager = new ExternalToolCompatibilityManager({
      cacheDirectory: await temporaryDirectory(),
      desktopVersion: '0.1.5-rc.2',
      now: () => new Date(manifestJson.issuedAt),
      fetch: vi.fn()
        .mockResolvedValueOnce(response(manifest))
        .mockResolvedValueOnce(response(bundleBytes(
          manifest,
          undefined,
          'external-tools-compatibility-0.1.5-rc.2.v2.json',
        ))),
      verifyBundle: async () => {},
    })

    await expect(manager.resolve('codex')).resolves.toMatchObject({ source: 'embedded' })
  })

  it('rejects an expired manifest', async () => {
    const cacheDirectory = await temporaryDirectory()
    const expired = manifestBytes({ ...manifestJson, expiresAt: '2026-09-02T00:00:00.000Z' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(expired))
      .mockResolvedValueOnce(response(bundleBytes(expired)))
    const manager = new ExternalToolCompatibilityManager({
      cacheDirectory,
      desktopVersion: manifestJson.desktopVersion,
      now: () => new Date(manifestJson.issuedAt),
      fetch: fetchMock,
      verifyBundle: async () => {},
    })

    await expect(manager.resolve('codex')).resolves.toMatchObject({ source: 'embedded' })
  })
})
