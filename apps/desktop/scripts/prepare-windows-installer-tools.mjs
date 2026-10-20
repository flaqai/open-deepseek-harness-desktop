/** Stage the checksum-pinned Windows extractor used by the NSIS installer. */
import { copyFile, lstat, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const BUILDER_VERSION = '26.17.0'

/** Return a fixed Windows tool request independent of the build host.
 * @returns {object} fresh downloader options with the reviewed archive checksum.
 */
export function windowsInstallerToolRequest() {
  return {
    releaseName: '7zip@1.0.0',
    filenameWithExt: '7zip-win-x64.tar.gz',
    checksums: { '7zip-win-x64.tar.gz': 'be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3' },
    githubOrgRepo: 'electron-userland/electron-builder-binaries',
  }
}

function loadBuilderDownloader() {
  const desktopRequire = createRequire(new URL('../package.json', import.meta.url))
  const builderRequire = createRequire(desktopRequire.resolve('electron-builder/package.json'))
  const builder = builderRequire('app-builder-lib/package.json')
  if (builder.version !== BUILDER_VERSION) {
    throw new Error(`prepare-windows-installer-tools: requires app-builder-lib ${BUILDER_VERSION}, received ${builder.version}`)
  }
  return builderRequire('app-builder-lib/out/util/electronGet.js').downloadBuilderToolset
}

/** Copy the pinned extractor and its licenses; a failed download or missing file stops preparation.
 * @param {{ repositoryRoot?: string, downloadBuilderToolset?: (request: ReturnType<typeof windowsInstallerToolRequest>) => Promise<string> }} options
 * Omitted options use this checkout and electron-builder's checksum-verifying downloader.
 * @returns {Promise<{ directory: string, executable: string, files: string[] }>} staged installer tool paths.
 */
export async function prepareWindowsInstallerTools(options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? REPOSITORY_ROOT)
  const download = options.downloadBuilderToolset ?? loadBuilderDownloader()
  const toolDirectory = await download(windowsInstallerToolRequest())
  const directory = join(repositoryRoot, '.artifacts', 'desktop-runtime-win-x64', 'installer')
  const files = [['bin/7za.exe', '7za.exe'], ['COPYING', 'COPYING'], ['LICENSE.txt', 'LICENSE.txt']]
  for (const [source] of files) {
    const metadata = await lstat(join(toolDirectory, source))
    if (!metadata.isFile() || metadata.size === 0) {
      throw new Error(`prepare-windows-installer-tools: missing ordinary nonempty tool file ${source}`)
    }
  }
  await mkdir(directory, { recursive: true })
  for (const [source, destination] of files) await copyFile(join(toolDirectory, source), join(directory, destination))
  return { directory, executable: join(directory, '7za.exe'), files: files.map(([, destination]) => destination) }
}
