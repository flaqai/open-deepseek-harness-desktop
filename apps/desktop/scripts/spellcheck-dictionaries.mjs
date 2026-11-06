/** Validate or refresh the reviewed, offline Electron Hunspell resources. */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import extractZip from 'extract-zip'

const assetDirectory = fileURLToPath(new URL('../assets/spellcheck-dictionaries/', import.meta.url))
const sha256 = data => createHash('sha256').update(data).digest('hex')

/**
 * Verify exact Electron compatibility and every bundled dictionary/license checksum.
 * @param {string} directory Directory containing the reviewed manifest and resources.
 * @returns {Promise<object>} Validated resource manifest.
 */
export async function verifyBundledSpellcheckDictionaries(directory = assetDirectory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  const { devDependencies } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.electronVersion !== devDependencies.electron
    || manifest.source.url !== `https://github.com/electron/electron/releases/download/v${manifest.electronVersion}/hunspell_dictionaries.zip`
    || !/^[a-f0-9]{64}$/u.test(manifest.source.sha256)) {
    throw new Error('Offline spellcheck resource manifest must match the pinned Electron release')
  }
  const expectedLanguages = ['de-DE', 'en-GB', 'en-US', 'es-ES', 'fr-FR', 'pt-BR', 'ru-RU']
  if (JSON.stringify(manifest.dictionaries.map(entry => entry.language).sort()) !== JSON.stringify(expectedLanguages)
    || !Array.isArray(manifest.notices) || manifest.notices.length === 0) {
    throw new Error('Offline spellcheck resource language or notice list is incomplete')
  }
  for (const entry of [...manifest.dictionaries, ...manifest.notices]) {
    if (!/^(?:[a-zA-Z0-9-]+\.bdic|COPYING(?:\.[A-Za-z0-9]+)?|LICENSE)$/u.test(entry.file)) {
      throw new Error('Invalid offline spellcheck resource filename')
    }
    const data = await readFile(join(directory, entry.file))
    if (data.length !== entry.bytes || sha256(data) !== entry.sha256) {
      throw new Error(`Offline spellcheck resource integrity mismatch: ${entry.file}`)
    }
  }
  return manifest
}

// Refresh is intentionally explicit and only accepts the already reviewed ZIP integrity.
// An Electron update needs a newly reviewed manifest, not an implicit latest download.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--refresh' && process.argv.length === 4) {
    const manifest = JSON.parse(await readFile(join(assetDirectory, 'manifest.json'), 'utf8'))
    const archive = await readFile(resolve(process.argv[3]))
    if (archive.length !== manifest.source.bytes || sha256(archive) !== manifest.source.sha256) {
      throw new Error('The dictionary ZIP does not match the reviewed source integrity')
    }
    const temporary = await mkdtemp(join(tmpdir(), 'odsh-spellcheck-'))
    try {
      await extractZip(resolve(process.argv[3]), { dir: temporary })
      // All validation precedes writing to the checked-in resource directory.
      await writeFile(join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
      await verifyBundledSpellcheckDictionaries(temporary)
      for (const entry of [...manifest.dictionaries, ...manifest.notices]) {
        await writeFile(join(assetDirectory, entry.file), await readFile(join(temporary, entry.file)))
      }
    } finally { await rm(temporary, { recursive: true, force: true }) }
  } else if (process.argv.length !== 2 && !(process.argv.length === 3 && process.argv[2] === '--check')) {
    throw new Error('Usage: node scripts/spellcheck-dictionaries.mjs [--check | --refresh /absolute/hunspell_dictionaries.zip]')
  }
  const manifest = await verifyBundledSpellcheckDictionaries()
  console.log(`Verified ${manifest.dictionaries.length} offline dictionaries for Electron ${manifest.electronVersion}`)
}
