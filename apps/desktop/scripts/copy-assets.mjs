import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const outputDirectory = fileURLToPath(new URL('../lib/', import.meta.url))
mkdirSync(outputDirectory, { recursive: true })
copyFileSync(
  fileURLToPath(new URL('../src/loading.html', import.meta.url)),
  fileURLToPath(new URL('../lib/loading.html', import.meta.url)),
)
copyFileSync(
  fileURLToPath(new URL('../src/icon.png', import.meta.url)),
  fileURLToPath(new URL('../lib/icon.png', import.meta.url)),
)
for (const filename of ['tray-iconTemplate.png', 'tray-iconTemplate@2x.png']) {
  copyFileSync(
    fileURLToPath(new URL(`../src/${filename}`, import.meta.url)),
    fileURLToPath(new URL(`../lib/${filename}`, import.meta.url)),
  )
}
