import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execute = promisify(execFile)
const fixture = fileURLToPath(new URL('./fixtures/installer-payload.ps1', import.meta.url))
const runtime = process.env.DSH_TEST_PWSH ?? (process.platform === 'win32' ? 'powershell.exe' : undefined)
const desktopRequire = createRequire(new URL('../package.json', import.meta.url))
const builderRequire = createRequire(desktopRequire.resolve('electron-builder'))
const asar = builderRequire('@electron/asar') as { createPackage(source: string, destination: string): Promise<void> }

async function createDesktopArchive(directory: string, version: string, coreVersion: string) {
  const input = join(directory, 'asar-input')
  await mkdir(join(input, 'lib'), { recursive: true })
  await writeFile(join(input, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop', version }))
  await writeFile(join(input, 'lib/harness-version.json'), JSON.stringify({ version: coreVersion, desktopVersion: version }))
  const archive = join(directory, 'source/resources/app.asar')
  await mkdir(join(directory, 'source/resources'), { recursive: true })
  await asar.createPackage(input, archive)
  return archive
}

interface ArchiveEntry { files?: Record<string, ArchiveEntry>; size?: number; offset?: string; unpacked?: boolean; link?: string }

function replaceArchiveHeader(archive: Buffer, mutate: (header: ArchiveEntry) => void) {
  const originalHeaderSize = archive.readUInt32LE(4)
  const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString()) as ArchiveEntry
  mutate(header)
  const json = Buffer.from(JSON.stringify(header))
  const headerSize = 8 + Math.ceil(json.length / 4) * 4
  const prefix = Buffer.alloc(8 + headerSize)
  prefix.writeUInt32LE(4, 0)
  prefix.writeUInt32LE(headerSize, 4)
  prefix.writeUInt32LE(headerSize - 4, 8)
  prefix.writeUInt32LE(json.length, 12)
  json.copy(prefix, 16)
  return Buffer.concat([prefix, archive.subarray(8 + originalHeaderSize)])
}

describe.skipIf(!runtime)('Windows installer payload behavior', () => {
  for (const [scenario, systemDirectory] of [
    ['robocopy-path-32bit-process', 'Sysnative'],
    ['robocopy-path-64bit-process', 'System32'],
    ['robocopy-path-32bit-os', 'System32'],
  ] as const) {
    it(scenario, async () => {
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-payload-')))
      try {
        const result = await execute(runtime ?? 'powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fixture,
          '-Scenario', scenario, '-FixtureDirectory', directory], { timeout: 20_000 })
        const report = JSON.parse(result.stdout.trim()) as { selectedPath: string }
        expect(report.selectedPath).toBe(join(directory, systemDirectory, 'robocopy.exe'))
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }, 25_000)
  }
  for (const scenario of [
    'success', 'robocopy-warning', 'copy-failure', 'copy-start-failure', 'missing-file',
    'wrong-size', 'extra-file', 'wrong-app-version', 'wrong-core-version', 'overlap',
    'root-target', 'source-reparse', 'target-reparse', 'copy-source-reparse', 'copy-target-reparse',
    'missing-executable', 'missing-manifest', 'malformed-manifest', 'prefix-sibling', 'independent-core-version',
    'wrong-pe-core', 'changed-pe-version',
  ]) {
    it(scenario, async () => {
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-payload-')))
      try {
        await createDesktopArchive(directory, scenario === 'wrong-app-version' ? '0.2.1-alpha.2' : '0.2.1-rc.2',
          scenario === 'independent-core-version' ? '0.2.1-alpha.3' : '0.2.1-rc.2')
        const result = await execute(runtime ?? 'powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fixture,
          '-Scenario', scenario, '-FixtureDirectory', directory], { timeout: 20_000 })
        const report = JSON.parse(result.stdout.trim()) as { exitCode: number; copyCalls: number; diagnosticPath: string }
        const success = ['success', 'robocopy-warning', 'prefix-sibling', 'independent-core-version'].includes(scenario)
        const validationFailure = ['overlap', 'root-target', 'source-reparse', 'target-reparse', 'missing-executable', 'missing-manifest'].includes(scenario)
        const copyFailure = ['copy-failure', 'copy-start-failure'].includes(scenario)
        expect(report.exitCode).toBe(success ? 0 : validationFailure ? 40 : copyFailure ? 41 : 42)
        const events = (await readFile(report.diagnosticPath, 'utf8')).trim().split('\n')
          .map(line => JSON.parse(line) as { stage: string; outcome: string })
        expect(events.at(-1)?.outcome).toBe(success ? 'verified' : 'failed')
        expect(events.some(event => event.stage === 'complete')).toBe(success)
        if (validationFailure) {
          expect(report.copyCalls).toBe(0)
        }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }, 25_000)
  }
  for (const scenario of ['current', 'previous', 'oversize-header', 'invalid-pickle', 'invalid-json', 'out-of-bounds',
    'oversize-document', 'unpacked', 'link', 'missing', 'different-name', 'identity-mismatch', 'wrong-pe-version']) {
    it(`archive identity: ${scenario}`, async () => {
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-version-')))
      try {
        const version = scenario === 'previous' ? '0.2.1-alpha.2' : '0.2.1-rc.2.1'
        const archive = await createDesktopArchive(directory, version, '0.2.1-rc.2')
        let bytes = await readFile(archive)
        if (scenario === 'oversize-header') bytes.writeUInt32LE(16777217, 4)
        if (scenario === 'invalid-pickle') bytes.writeUInt32LE(0, 8)
        if (scenario === 'invalid-json') bytes[16] = 0xff
        if (['out-of-bounds', 'oversize-document', 'unpacked', 'link', 'missing'].includes(scenario)) {
          bytes = replaceArchiveHeader(bytes, (header) => {
            const entry = header.files?.['package.json']
            if (!entry || !header.files) throw new Error('Real ASAR fixture is missing package.json')
            if (scenario === 'out-of-bounds') entry.offset = '9223372036854775807'
            if (scenario === 'oversize-document') entry.size = 1048577
            if (scenario === 'unpacked') entry.unpacked = true
            if (scenario === 'link') entry.link = 'elsewhere.json'
            if (scenario === 'missing') delete header.files['package.json']
          })
        }
        if (scenario === 'different-name') bytes = Buffer.from(bytes.toString('latin1').replace('@deepseek-ai/dsh-desktop', '@deepseek-ai/xxx-desktop'), 'latin1')
        if (scenario === 'identity-mismatch') {
          const index = bytes.lastIndexOf(Buffer.from(version))
          if (index < 0) throw new Error('Real ASAR fixture has no version')
          Buffer.from('0.2.1-rc.2.9').copy(bytes, index)
        }
        await writeFile(archive, bytes)
        const run = execute(runtime ?? 'powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
          fileURLToPath(new URL('./fixtures/installer-version.ps1', import.meta.url)), '-InstallDirectory', join(directory, 'source'),
          '-ProductVersion', scenario === 'wrong-pe-version' ? '0.2.2.0' : '0.2.1.0'], { timeout: 20_000 })
        if (scenario === 'current' || scenario === 'previous') {
          const result = await run
          const identity = JSON.parse(result.stdout.trim()) as { Version: string; CoreVersion: string; ProductVersion: string }
          expect(identity).toMatchObject({ Version: version, CoreVersion: '0.2.1-rc.2', ProductVersion: '0.2.1.0' })
        } else await expect(run).rejects.toThrow()
      } finally { await rm(directory, { recursive: true, force: true }) }
    }, 25_000)
  }
})
