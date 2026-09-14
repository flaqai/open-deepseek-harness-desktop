/** Verify final installed resources, including changes made by copying and native signing. */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { deployPrebuiltProfile, readPrebuiltProfile } from '../lib/prebuilt-profile.js'

const resources = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('Usage: verify-prebuilt-profile.mjs <application resources>')
const source = join(resources, 'prebuilt-profile')
const manifest = await readPrebuiltProfile(source)
if (manifest === undefined) throw new Error('Missing packaged prebuilt Profile')
const pluginSource = await readFile(join(resources, 'bundled-plugins/manifest.json'), 'utf8')
if (manifest.identity.pluginManifestSha256 !== createHash('sha256').update(pluginSource).digest('hex')) throw new Error('Packaged preset manifest differs from prebuilt Profile')
const destination = await mkdtemp(join(tmpdir(), 'dsh packaged profile '))
const started = Date.now()
try {
  await deployPrebuiltProfile(source, destination, manifest, new AbortController().signal, () => {})
  for (const plugin of JSON.parse(pluginSource).plugins.filter(plugin => plugin.installPolicy === 'startup')) {
    const installed = JSON.parse(await readFile(join(destination, 'profiles/web/node_modules', plugin.packageName, 'package.json'), 'utf8'))
    if (installed.name !== plugin.packageName || installed.version !== plugin.version) throw new Error(`Incomplete preset: ${plugin.packageName}`)
  }
  console.log(`PASS prebuilt Profile: ${manifest.files.length} resources; ${Date.now() - started}ms deployment; ${manifest.fingerprint}`)
} finally {
  await rm(destination, { recursive: true, force: true })
}
