import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readRecoveryFailureSummary } from '../src/recovery-failure.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function homeWithReport(report: unknown): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-recovery-failure-'))
  roots.push(home)
  await mkdir(join(home, 'profile-health'))
  await writeFile(join(home, 'profile-health', 'web.diagnostics.json'), JSON.stringify(report))
  return home
}

describe('Desktop recovery failure summary', () => {
  it('selects the highest-urgency issue and exposes only bounded diagnostic fields', async () => {
    const home = await homeWithReport({
      schema: 'dsh/profile-diagnostic/v2', profile: 'web', issues: [
        { code: 'pnpm.network', severity: 'warning', evidence: ['temporary failure'] },
        {
          code: 'loader.duplicate-entry', nativeCode: 'DUPLICATE_ENTRY', severity: 'blocked',
          attribution: { rootPackage: 'dsh-file-upload', entryId: 'file-upload', moduleName: './client.js' },
          evidence: ['External Bundle dsh-file-upload duplicates installation entry file-upload'],
        },
      ],
    })

    expect(readRecoveryFailureSummary(home)).toEqual({
      diagnosticCode: 'loader.duplicate-entry', nativeCode: 'DUPLICATE_ENTRY',
      packageName: 'dsh-file-upload', entryId: 'file-upload', moduleName: './client.js',
      evidence: 'External Bundle dsh-file-upload duplicates installation entry file-upload',
    })
  })

  it('reports damaged diagnostic metadata without guessing a responsible plugin', async () => {
    const home = await homeWithReport('{not-json')

    expect(readRecoveryFailureSummary(home)).toEqual({
      diagnosticCode: 'desktop.diagnostic-report-invalid',
    })
  })
})
