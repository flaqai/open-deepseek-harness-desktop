/** Resolve the packaged Office provider's Kit before preparing a verified engine artifact. */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { test } from 'node:test'

test('engine metadata follows the new Office provider installation without the retired provider directory', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-office-provider-'))
  t.after(() => { rmSync(root, { recursive: true, force: true }) })
  const provider = join(root, 'packages', 'document', 'office-kit')
  const kit = join(provider, 'node_modules', '@deepseek-ai', 'libreoffice-kit')
  mkdirSync(kit, { recursive: true })
  writeFileSync(join(provider, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-office-kit' }))
  writeFileSync(join(kit, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/libreoffice-kit', version: '0.2.3',
    optionalDependencies: { '@deepseek-ai/libreoffice-kit-darwin-arm64': '0.2.3' },
  }))
  const url = 'https://registry.npmjs.org/@deepseek-ai/libreoffice-kit-darwin-arm64/-/libreoffice-kit-darwin-arm64-0.2.3.tgz'
  const mock = t.mock.method(childProcess, 'execFileSync', (_command, args) => {
    if (args.includes('--range')) return 'HTTP/1.1 206 Partial Content\r\ncontent-range: bytes 0-0/1024\r\n'
    const destination = args[args.indexOf('--output') + 1]
    writeFileSync(destination, JSON.stringify({ name: '@deepseek-ai/libreoffice-kit-darwin-arm64', version: '0.2.3',
      dist: { tarball: url, integrity: 'sha512-AAAA' } }))
    return ''
  })
  syncBuiltinESMExports()
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  const { officialOfficeArtifact } = await import('./official-office-runtime.ts')
  const artifact = officialOfficeArtifact({ release: 'darwin-arm64', platform: 'darwin', arch: 'arm64' }, root, join(root, 'cache'))
  assert.equal(artifact.engineVersion, '0.2.3')
  assert.equal(artifact.enginePackage, '@deepseek-ai/libreoffice-kit-darwin-arm64')
  assert.equal(artifact.url, url)
  assert.equal(artifact.size, 1024)
  assert.equal(artifact.integrity, 'sha512-AAAA')
  assert.equal(mock.mock.calls.length, 2)
})
