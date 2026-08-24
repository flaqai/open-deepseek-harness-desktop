/** Source-mode staging for the real incompatible-plugin diagnostic fixture. */

import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'

/** Package identity used in the durable quarantine record. */
export const DIAGNOSTIC_FIXTURE_PACKAGE = '@hecoococ/dsh-diagnostic-conflict-fixture'

function writeTarText(header: Buffer, offset: number, length: number, value: string): void {
  header.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8')
}

function writeTarOctal(header: Buffer, offset: number, length: number, value: number): void {
  writeTarText(header, offset, length, value.toString(8).padStart(length - 1, '0'))
}

function tarEntry(name: string, contents: Buffer): Buffer {
  const header = Buffer.alloc(512)
  writeTarText(header, 0, 100, name)
  writeTarOctal(header, 100, 8, 0o644)
  writeTarOctal(header, 108, 8, 0)
  writeTarOctal(header, 116, 8, 0)
  writeTarOctal(header, 124, 12, contents.length)
  writeTarOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header.write('0', 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  const padding = Buffer.alloc((512 - (contents.length % 512)) % 512)
  return Buffer.concat([header, contents, padding])
}

async function packDiagnosticFixture(directory: string, archive: string): Promise<void> {
  const files = [
    ['package/package.json', join(directory, 'package.json')],
    ['package/cordis.patch.yml', join(directory, 'cordis.patch.yml')],
    [
      'package/node_modules/@deepseek-ai/dsh-tools/package.json',
      join(directory, 'node_modules', '@deepseek-ai', 'dsh-tools', 'package.json'),
    ],
  ] as const
  const entries = await Promise.all(files.map(async ([name, path]) => tarEntry(name, await readFile(path))))
  await writeFile(archive, gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]), { level: 9 }))
}

/**
 * Copy and pack the reviewed fixture with its deliberately shadowed Host package.
 * The repository keeps that package outside `node_modules` so it remains trackable;
 * the generated tarball uses npm's bundled-dependency layout so pnpm can both install
 * and physically remove it through the ordinary production quarantine transaction.
 * @param source - Reviewed source fixture directory.
 * @param destination - Private staging directory outside the managed profile.
 * @returns Absolute path to the generated installable tarball.
 */
export async function stageDiagnosticFixture(source: string, destination: string): Promise<string> {
  await rm(destination, { recursive: true, force: true })
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination, { recursive: true })
  const shadow = join(destination, 'node_modules', '@deepseek-ai', 'dsh-tools')
  await mkdir(dirname(shadow), { recursive: true })
  await rename(join(destination, 'fake-dsh-tools'), shadow)
  const archive = join(dirname(destination), 'diagnostic-conflict-fixture.tgz')
  await packDiagnosticFixture(destination, archive)
  return archive
}
