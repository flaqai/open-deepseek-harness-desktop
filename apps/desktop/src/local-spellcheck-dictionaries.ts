/** Offline Hunspell dictionary delivery; no input text is sent to a dictionary server. */
import { randomBytes, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'

/** Electron Session operations needed to configure local dictionary delivery. */
export interface SpellcheckDictionarySession {
  readonly availableSpellCheckerLanguages: string[]
  setSpellCheckerDictionaryDownloadURL(url: string): void
  setSpellCheckerLanguages(languages: string[]): void
  setSpellCheckerEnabled(enabled: boolean): void
}
interface DictionaryEntry {
  language: string
  file: string
  bytes: number
  sha256: string
}

function parseDictionaryEntries(value: unknown): DictionaryEntry[] {
  if (typeof value !== 'object' || value === null || !('dictionaries' in value)
    || !Array.isArray(value.dictionaries) || value.dictionaries.length === 0 || value.dictionaries.length > 16) {
    throw new Error('desktop: invalid local spellchecker dictionary manifest')
  }
  return value.dictionaries.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null
      || !('language' in entry) || typeof entry.language !== 'string' || !/^[a-z]{2}-[A-Z]{2}$/u.test(entry.language)
      || !('file' in entry) || typeof entry.file !== 'string' || !/^[a-zA-Z0-9-]+\.bdic$/u.test(entry.file)
      || !('sha256' in entry) || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.sha256)
      || !('bytes' in entry) || typeof entry.bytes !== 'number' || !Number.isSafeInteger(entry.bytes)
      || entry.bytes <= 0 || entry.bytes > 32 * 1024 * 1024) {
      throw new Error('desktop: invalid local spellchecker dictionary entry')
    }
    return { language: entry.language, file: entry.file, bytes: entry.bytes, sha256: entry.sha256 }
  })
}

/**
 * Serve bundled dictionaries only on loopback before enabling spellchecking.
 * macOS keeps its native spellchecker and requires no Hunspell resources.
 * @param session Trusted desktop Session, configured before its first renderer starts.
 * @param options Local platform, resource directory and preferred UI/system language.
 * @returns Async cleanup for the owned local server; no browser or external connection is started.
 * @throws When bundled dictionaries are missing, invalid, or cannot be served locally.
 */
export async function setupLocalSpellcheckDictionaries(session: SpellcheckDictionarySession, options: {
  platform: string
  directory: string
  locale: string
}): Promise<() => Promise<void>> {
  if (options.platform === 'darwin') return async () => {}
  session.setSpellCheckerEnabled(false)
  // Fail closed even if resource validation or listen fails; never retain the CDN default.
  session.setSpellCheckerDictionaryDownloadURL('http://127.0.0.1:9/unavailable-dictionaries/')
  const entries = parseDictionaryEntries(JSON.parse(await readFile(join(options.directory, 'manifest.json'), 'utf8')))
  const files = new Map<string, Buffer>()
  for (const entry of entries) {
    const data = await readFile(join(options.directory, entry.file))
    if (data.length !== entry.bytes || createHash('sha256').update(data).digest('hex') !== entry.sha256) {
      throw new Error(`desktop: damaged local spellchecker dictionary ${entry.file}`)
    }
    const key = entry.file.toLowerCase()
    if (files.has(key)) throw new Error('desktop: duplicate local spellchecker dictionary')
    files.set(key, data)
  }
  const prefix = `/${randomBytes(16).toString('hex')}/`
  const server = createServer((request, response) => {
    const path = request.url ?? ''
    const filename = path.startsWith(prefix) ? path.slice(prefix.length).toLowerCase() : ''
    const data = files.get(filename)
    if (!data || !['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(404).end(); return
    }
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' })
    response.end(request.method === 'HEAD' ? undefined : data)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  server.unref()
  let closing: Promise<void> | undefined
  const close = () => closing ??= new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
    server.closeAllConnections()
  })
  try {
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('desktop: missing local dictionary server address')
    const languages = entries.map(entry => entry.language)
      .map(language => session.availableSpellCheckerLanguages.find(available => available.toLowerCase() === language.toLowerCase())
        ?? session.availableSpellCheckerLanguages.find(available => available.toLowerCase() === language.split('-')[0]?.toLowerCase()))
      .filter((language): language is string => language !== undefined)
    const preferred = languages.find(language => language.toLowerCase() === options.locale.toLowerCase())
      ?? languages.find(language => language.split('-')[0]?.toLowerCase() === options.locale.split('-')[0]?.toLowerCase())
    const english = languages.find(language => language.toLowerCase() === 'en-us') ?? languages.find(language => language.startsWith('en'))
    const selected = [...new Set([preferred, english].filter((language): language is string => language !== undefined))]
    if (selected.length === 0) throw new Error('desktop: no bundled spellchecker language is supported by Electron')
    session.setSpellCheckerDictionaryDownloadURL(`http://127.0.0.1:${address.port}${prefix}`)
    session.setSpellCheckerLanguages(selected)
    session.setSpellCheckerEnabled(true)
    return close
  } catch (error) { await close(); throw error }
}
