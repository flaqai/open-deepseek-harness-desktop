import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outputDirectory = fileURLToPath(new URL('../lib/', import.meta.url))
mkdirSync(outputDirectory, { recursive: true })
// TypeScript does not prune removed sources; never ship stale Orb output from a prior build.
for (const directory of [outputDirectory, fileURLToPath(new URL('../lib/types/', import.meta.url))]) {
  if (!existsSync(directory)) continue
  for (const name of readdirSync(directory)) {
    if (/^(?:orb-|liborb-)/u.test(name)) rmSync(join(directory, name), { force: true, recursive: true })
  }
}
// tsc does not delete outputs for removed sources. Do not ship stale standalone
// desktop carrier or updater modules after building this community checkout.
for (const name of [
  'core-package-set', 'host-process', 'host-protocol', 'ipc', 'locale', 'paths',
  'preload-app', 'project-manager', 'release', 'seed-store', 'single-instance', 'update-coordinator',
]) {
  if (existsSync(new URL(`../src/${name}.ts`, import.meta.url))) continue
  for (const extension of ['js', 'js.map']) rmSync(new URL(`../lib/${name}.${extension}`, import.meta.url), { force: true })
}
const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'))
const { version: desktopVersion } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
writeFileSync(new URL('../lib/harness-version.json', import.meta.url), `${JSON.stringify({ version, desktopVersion })}\n`)
copyFileSync(
  fileURLToPath(new URL('../src/loading.html', import.meta.url)),
  fileURLToPath(new URL('../lib/loading.html', import.meta.url)),
)
copyFileSync(
  fileURLToPath(new URL('../src/data-home.html', import.meta.url)),
  fileURLToPath(new URL('../lib/data-home.html', import.meta.url)),
)
copyFileSync(
  fileURLToPath(new URL('../src/data-home-preview.js', import.meta.url)),
  fileURLToPath(new URL('../lib/data-home-preview.js', import.meta.url)),
)
copyFileSync(
  fileURLToPath(new URL('../src/titlebar.html', import.meta.url)),
  fileURLToPath(new URL('../lib/titlebar.html', import.meta.url)),
)
copyFileSync(
  fileURLToPath(new URL('../src/question-outline-14.svg', import.meta.url)),
  fileURLToPath(new URL('../lib/question-outline-14.svg', import.meta.url)),
)
copyFileSync(
  fileURLToPath(new URL('../src/close-outline-16.svg', import.meta.url)),
  fileURLToPath(new URL('../lib/close-outline-16.svg', import.meta.url)),
)
copyFileSync(
  fileURLToPath(new URL('../src/icon.png', import.meta.url)),
  fileURLToPath(new URL('../lib/icon.png', import.meta.url)),
)
copyFileSync(
  fileURLToPath(new URL('../src/dev-dock-icon.png', import.meta.url)),
  fileURLToPath(new URL('../lib/dev-dock-icon.png', import.meta.url)),
)
for (const filename of ['tray-iconTemplate.png', 'tray-iconTemplate@2x.png']) {
  copyFileSync(
    fileURLToPath(new URL(`../src/${filename}`, import.meta.url)),
    fileURLToPath(new URL(`../lib/${filename}`, import.meta.url)),
  )
}
