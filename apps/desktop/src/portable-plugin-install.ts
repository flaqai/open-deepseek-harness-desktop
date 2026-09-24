/** Install verified offline archives inside the desktop candidate, never from transfer staging. */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { verifyPreparedPortablePluginBundle } from './portable-plugin-bundle.ts'
import { mergePortablePluginStore } from './portable-plugin-store.ts'

export interface PortablePluginCandidateInstall {
  readonly activeHome: string
  readonly candidateHome: string
  readonly bundleDirectory: string
  readonly selectedPackages: readonly string[]
  run(args: readonly string[], environment: NodeJS.ProcessEnv): Promise<string>
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Caller must hold the managed Profile mutation lease and await candidate activation afterward. */
export async function installPortablePluginCandidate(options: PortablePluginCandidateInstall): Promise<string> {
  const bundle = await verifyPreparedPortablePluginBundle(options.bundleDirectory)
  const selected = new Set(options.selectedPackages)
  if (selected.size === 0 || selected.size !== options.selectedPackages.length) {
    throw new TypeError('desktop: select distinct portable plugin packages')
  }
  const artifacts = bundle.artifacts.filter(artifact => selected.has(artifact.packageName))
  if (artifacts.length !== selected.size) throw new Error('desktop: portable plugin selection is not in the verified bundle')

  // The pnpm content store belongs to the active home even while the Profile lives in a candidate.
  // Entries are immutable; a matching existing entry is reused and a conflicting entry fails closed.
  await mergePortablePluginStore(options.bundleDirectory, options.activeHome)
  const archiveDirectory = join(options.candidateHome, 'bundled-plugins')
  await mkdir(archiveDirectory, { recursive: true, mode: 0o700 })
  const archives: string[] = []
  for (const artifact of artifacts) {
    const archive = join(archiveDirectory, `portable-${artifact.sha256}.tgz`)
    const source = join(options.bundleDirectory, artifact.file)
    let copied = false
    try {
      await copyFile(source, archive, constants.COPYFILE_EXCL)
      copied = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await lstat(archive)
      if (!existing.isFile()) throw new Error('desktop: candidate portable archive is not a regular file')
    }
    if (await sha256(archive) !== artifact.sha256) {
      if (copied) await rm(archive, { force: true })
      throw new Error(`desktop: candidate portable archive differs from verified bundle: ${artifact.packageName}`)
    }
    archives.push(archive)
  }
  return options.run([
    'add', '--offline', '--save-exact',
    ...(bundle.registry === undefined ? [] : [`--registry=${bundle.registry}`]),
    `--config.cache-dir=${join(options.bundleDirectory, 'cache')}`,
    ...archives,
  ], {
    npm_config_offline: 'true',
    PNPM_CONFIG_FETCH_RETRIES: '0',
    COREPACK_ENABLE_NETWORK: '0',
  })
}
