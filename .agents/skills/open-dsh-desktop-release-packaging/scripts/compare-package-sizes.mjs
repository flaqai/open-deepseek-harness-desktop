#!/usr/bin/env node

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const installerName = /^DeepSeek-Harness-(?:windows-x64\.(?:exe|zip)|macos-(?:arm64|x64)\.(?:dmg|zip)|linux-x64\.(?:deb|rpm))$/u
const mib = bytes => (bytes / 1048576).toFixed(1)

async function readInstallers(directory) {
  const names = (await readdir(directory)).filter(name => installerName.test(name)).sort()
  if (names.length === 0) throw new Error(`no desktop installers in ${directory}`)
  const sizes = new Map()
  for (const name of names) {
    const info = await stat(join(directory, name))
    if (!info.isFile() || info.size === 0) throw new Error(`empty or non-file installer: ${join(directory, name)}`)
    sizes.set(name, info.size)
  }
  return sizes
}

export async function comparePackageSizes(currentDirectory, baselineDirectory) {
  const current = await readInstallers(currentDirectory)
  const baseline = baselineDirectory ? await readInstallers(baselineDirectory) : null
  const rows = [...current].map(([name, bytes]) => ({ name, bytes, baselineBytes: baseline?.get(name) }))
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0)
  const comparable = rows.filter(row => row.baselineBytes !== undefined)
  const comparableBytes = comparable.reduce((sum, row) => sum + row.bytes, 0)
  const baselineBytes = comparable.reduce((sum, row) => sum + row.baselineBytes, 0)
  return { rows, totalBytes, comparableBytes, baselineBytes }
}

export function formatPackageSizes(report) {
  const delta = (now, before) => before === undefined ? '—' : `${((now - before) / before * 100).toFixed(1)}%`
  const lines = [
    '| Installer | Current bytes | Current MiB | Baseline bytes | Change |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...report.rows.map(row => `| ${row.name} | ${row.bytes} | ${mib(row.bytes)} | ${row.baselineBytes ?? '—'} | ${delta(row.bytes, row.baselineBytes)} |`),
    `| Download total for listed installers | ${report.totalBytes} | ${mib(report.totalBytes)} | — | — |`,
  ]
  if (report.baselineBytes > 0) {
    lines.push(`| Matched installers only | ${report.comparableBytes} | ${mib(report.comparableBytes)} | ${report.baselineBytes} | ${delta(report.comparableBytes, report.baselineBytes)} |`)
  }
  return lines.join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  if (args.length < 1 || args.length > 2) {
    console.error('Usage: compare-package-sizes.mjs <current-installer-directory> [baseline-installer-directory]')
    process.exitCode = 2
  } else {
    console.log(formatPackageSizes(await comparePackageSizes(args[0], args[1])))
  }
}
