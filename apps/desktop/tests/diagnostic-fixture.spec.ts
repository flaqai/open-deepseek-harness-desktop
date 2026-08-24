import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { DIAGNOSTIC_FIXTURE_PACKAGE, stageDiagnosticFixture } from '../src/diagnostic-fixture.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('diagnostic fixture staging', () => {
  it('materializes a real nested incompatible Host package without touching the source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-diagnostic-fixture-'))
    roots.push(root)
    const source = join(import.meta.dirname, '..', 'fixtures', 'diagnostic-incompatible-plugin')
    const destination = join(root, 'fixture')

    const archive = await stageDiagnosticFixture(source, destination)
    expect(archive).toBe(join(root, 'diagnostic-conflict-fixture.tgz'))
    const fixture = JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8')) as {
      name: string
      dependencies: Record<string, string>
    }
    const shadow = JSON.parse(readFileSync(
      join(destination, 'node_modules', '@deepseek-ai', 'dsh-tools', 'package.json'),
      'utf8',
    )) as { name: string; version: string }

    expect(fixture.name).toBe(DIAGNOSTIC_FIXTURE_PACKAGE)
    expect(fixture.dependencies['@deepseek-ai/dsh-tools']).toBe('^0.0.0')
    expect(shadow).toMatchObject({ name: '@deepseek-ai/dsh-tools', version: '0.0.0-diagnostic-fixture' })
    const packed = gunzipSync(readFileSync(archive)).toString('utf8')
    expect(packed).toContain('package/node_modules/@deepseek-ai/dsh-tools/package.json')
    expect(packed).toContain('0.0.0-diagnostic-fixture')
    expect(existsSync(join(source, 'fake-dsh-tools', 'package.json'))).toBe(true)
  })
})
