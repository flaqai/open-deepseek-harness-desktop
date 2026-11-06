/** Local dictionary delivery never needs a public server or user input text. */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setupLocalSpellcheckDictionaries, type SpellcheckDictionarySession } from '../src/local-spellcheck-dictionaries.js'

const directories: string[] = []
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(close => close()))
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})
function fakeSession(languages = ['en-US', 'en-GB', 'fr', 'pt-BR']) {
  return {
    availableSpellCheckerLanguages: languages,
    setSpellCheckerEnabled: vi.fn<(enabled: boolean) => void>(),
    setSpellCheckerDictionaryDownloadURL: vi.fn<(url: string) => void>(),
    setSpellCheckerLanguages: vi.fn<(languages: string[]) => void>(),
  } satisfies SpellcheckDictionarySession
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'odsh-spellcheck-test-'))
  directories.push(directory)
  const data = Buffer.from('BDic-test-fixture')
  const dictionaries = ['en-US', 'en-GB', 'fr-FR', 'pt-BR'].map(language => ({
    language, file: `${language}-3-0.bdic`, bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  }))
  for (const entry of dictionaries) await writeFile(join(directory, entry.file), data)
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ dictionaries }))
  return { directory, data, dictionaries }
}
async function read(url: URL, path = url.pathname, method = 'GET') {
  return await new Promise<{ status: number | undefined; data: Buffer }>((resolve, reject) => {
    const outgoing = request({ hostname: url.hostname, port: url.port, path, method }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('error', reject)
      response.on('end', () =>{  resolve({ status: response.statusCode, data: Buffer.concat(chunks) }) })
    })
    outgoing.on('error', reject)
    outgoing.end()
  })
}
async function start(session = fakeSession(), locale = 'fr-FR') {
  const assets = await fixture()
  const close = await setupLocalSpellcheckDictionaries(session, { platform: 'win32', directory: assets.directory, locale })
  cleanups.push(close)
  const base = session.setSpellCheckerDictionaryDownloadURL.mock.lastCall?.[0]
  if (base === undefined) throw new Error('Dictionary URL was not configured')
  return { ...assets, session, close, base: new URL(base) }
}

describe('offline spellchecker dictionaries', () => {
  it('sets a loopback-only source before languages and enabling, and serves official filenames case-insensitively', async () => {
    const { base, session, data } = await start()
    expect(base.hostname).toBe('127.0.0.1')
    expect(session.setSpellCheckerEnabled.mock.calls).toEqual([[false], [true]])
    expect(session.setSpellCheckerLanguages).toHaveBeenCalledWith(['fr', 'en-US'])
    expect(session.setSpellCheckerDictionaryDownloadURL.mock.invocationCallOrder[1])
      .toBeLessThan(session.setSpellCheckerLanguages.mock.invocationCallOrder[0]!)
    expect(session.setSpellCheckerLanguages.mock.invocationCallOrder[0])
      .toBeLessThan(session.setSpellCheckerEnabled.mock.invocationCallOrder[1]!)
    expect(await read(new URL('EN-us-3-0.BDIC', base))).toEqual({ status: 200, data })
    expect(await read(new URL('en-US-3-0.bdic', base), `${base.pathname}en-US-3-0.bdic`, 'HEAD'))
      .toEqual({ status: 200, data: Buffer.alloc(0) })
  })

  it('refuses unknown files, traversal, query strings, directory listings and writes', async () => {
    const { base } = await start()
    for (const path of ['/', base.pathname, `${base.pathname}manifest.json`, `${base.pathname}../en-US-3-0.bdic`,
      `${base.pathname}%2e%2e/en-US-3-0.bdic`, `${base.pathname}en-US-3-0.bdic?text=secret`,
      `${base.pathname}LICENSE`, `${base.pathname}.hidden`, '/en-US-3-0.bdic']) {
      expect((await read(base, path)).status).toBe(404)
    }
    expect((await read(base, `${base.pathname}en-US-3-0.bdic`, 'POST')).status).toBe(404)
  })

  it('keeps the session disabled with a local-only failure URL when assets are missing or corrupt', async () => {
    const { directory } = await fixture()
    await writeFile(join(directory, 'en-US-3-0.bdic'), 'corrupt')
    const session = fakeSession()
    await expect(setupLocalSpellcheckDictionaries(session, { platform: 'linux', directory, locale: 'en-US' }))
      .rejects.toThrow('damaged local spellchecker dictionary')
    expect(session.setSpellCheckerEnabled.mock.calls).toEqual([[false]])
    expect(session.setSpellCheckerLanguages).not.toHaveBeenCalled()
    expect(session.setSpellCheckerDictionaryDownloadURL).toHaveBeenLastCalledWith('http://127.0.0.1:9/unavailable-dictionaries/')
    await expect(setupLocalSpellcheckDictionaries(session, { platform: 'linux', directory: join(directory, 'missing'), locale: 'en-US' }))
      .rejects.toThrow()
  })

  it('validates malformed manifests, filenames and duplicate files before delivery', async () => {
    const { directory, dictionaries } = await fixture()
    for (const manifest of [null, {}, { dictionaries: [] }, { dictionaries: [{ ...dictionaries[0], file: '../file.bdic' }] },
      { dictionaries: [{ ...dictionaries[0], bytes: -1 }] }, { dictionaries: Array(17).fill(dictionaries[0]) },
      { dictionaries: [dictionaries[0], dictionaries[0]] }]) {
      await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))
      const session = fakeSession()
      await expect(setupLocalSpellcheckDictionaries(session, { platform: 'win32', directory, locale: 'en-US' }))
        .rejects.toThrow()
      expect(session.setSpellCheckerEnabled).not.toHaveBeenCalledWith(true)
    }
  })

  it('does not load files or modify the system spellchecker on macOS', async () => {
    const session = fakeSession()
    const close = await setupLocalSpellcheckDictionaries(session, { platform: 'darwin', directory: '/does-not-exist', locale: 'ja-JP' })
    await close()
    expect(session.setSpellCheckerEnabled).not.toHaveBeenCalled()
    expect(session.setSpellCheckerDictionaryDownloadURL).not.toHaveBeenCalled()
    expect(session.setSpellCheckerLanguages).not.toHaveBeenCalled()
  })

  it('falls back to bundled English for unsupported UI languages and honors British English', async () => {
    const japanese = await start(fakeSession(), 'ja-JP')
    expect(japanese.session.setSpellCheckerLanguages).toHaveBeenCalledWith(['en-US'])
    const british = await start(fakeSession(), 'en-GB')
    expect(british.session.setSpellCheckerLanguages).toHaveBeenCalledWith(['en-GB', 'en-US'])
  })

  it('closes the owned server idempotently and does not change any user dictionary cache', async () => {
    const { base, close, directory } = await start()
    const sentinel = join(directory, 'Custom Dictionary.txt')
    await writeFile(sentinel, 'user vocabulary')
    await close()
    await close()
    await expect(read(base)).rejects.toThrow()
    expect(await readFile(sentinel, 'utf8')).toBe('user vocabulary')
  })

  it('closes delivery if Session setup fails after listening', async () => {
    const { directory } = await fixture()
    const session = fakeSession([])
    await expect(setupLocalSpellcheckDictionaries(session, { platform: 'win32', directory, locale: 'fr-FR' }))
      .rejects.toThrow('no bundled spellchecker language')
    expect(session.setSpellCheckerEnabled).not.toHaveBeenCalledWith(true)
    const throwingSession = fakeSession()
    throwingSession.setSpellCheckerLanguages.mockImplementation(() => { throw new Error('Session setup failed') })
    await expect(setupLocalSpellcheckDictionaries(throwingSession, { platform: 'win32', directory, locale: 'fr-FR' }))
      .rejects.toThrow('Session setup failed')
    const failedSource = throwingSession.setSpellCheckerDictionaryDownloadURL.mock.lastCall?.[0]
    if (failedSource === undefined) throw new Error('Expected local delivery URL')
    await expect(read(new URL(failedSource))).rejects.toThrow()
    expect(throwingSession.setSpellCheckerEnabled).not.toHaveBeenCalledWith(true)
  })
})
