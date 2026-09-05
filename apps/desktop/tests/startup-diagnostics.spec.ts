import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearStartupDiagnostics,
  readStartupDiagnostics,
  recordStartupDiagnostic,
} from '../src/startup-diagnostics.ts'

const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

function fixture(): string {
  const home = mkdtempSync(join(tmpdir(), 'desktop-startup-diagnostics-'))
  homes.push(home)
  return home
}

describe('desktop startup diagnostics', () => {
  it('deduplicates the same operation and package without retaining raw output', async () => {
    const home = fixture()
    await recordStartupDiagnostic(home, {
      code: 'runtime.bundled-plugin-timeout',
      operation: 'bundled-plugin-install',
      packageName: 'dshmarket',
      actions: ['diagnostics', 'open-log', 'retry-plugin'],
    })
    await recordStartupDiagnostic(home, {
      code: 'runtime.bundled-plugin-timeout',
      operation: 'bundled-plugin-install',
      packageName: 'dshmarket',
      actions: ['diagnostics', 'open-log', 'retry-plugin'],
    })

    const incidents = await readStartupDiagnostics(home)
    expect(incidents).toHaveLength(1)
    expect(incidents[0]).toMatchObject({
      code: 'runtime.bundled-plugin-timeout',
      packageName: 'dshmarket',
    })
    expect(JSON.stringify(incidents)).not.toContain(home)
  })

  it('clears recovered incidents after a fully healthy startup', async () => {
    const home = fixture()
    await recordStartupDiagnostic(home, {
      code: 'runtime.profile-check-timeout',
      operation: 'profile-check',
      actions: ['diagnostics', 'open-log'],
    })
    await clearStartupDiagnostics(home)
    await expect(readStartupDiagnostics(home)).resolves.toEqual([])
  })

  it('drops forged codes and actions from a damaged local document', async () => {
    const home = fixture()
    const diagnostics = join(home, 'diagnostics')
    mkdirSync(diagnostics, { recursive: true })
    writeFileSync(join(diagnostics, 'desktop-startup.v1.json'), JSON.stringify({
      schema: 'dsh/desktop-startup-diagnostic/v1',
      incidents: [{
        incidentId: 'forged',
        code: 'runtime.run-arbitrary-command',
        operation: 'arbitrary',
        createdAt: new Date().toISOString(),
        actions: ['execute-command'],
      }],
    }))

    await expect(readStartupDiagnostics(home)).resolves.toEqual([])
  })
})
