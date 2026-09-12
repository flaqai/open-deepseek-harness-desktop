import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  backupAndResetInvalidSettings,
  prepareDiagnosticRuntimeDirectories,
  prepareDiagnosticSettingsDocument,
} from '../src/settings-diagnostics.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function home(): string {
  const value = mkdtempSync(join(tmpdir(), 'dsh-settings-diagnostic-'))
  roots.push(value)
  return value
}

describe('settings diagnostic recovery', () => {
  it('uses an isolated empty settings document in diagnostic mode', () => {
    const root = home()
    writeFileSync(join(root, 'settings.yaml'), 'duplicate: 1\nduplicate: 2\n')
    const diagnostic = prepareDiagnosticSettingsDocument(root)
    expect(diagnostic).not.toBe(join(root, 'settings.yaml'))
    expect(readFileSync(diagnostic, 'utf8')).toBe('{}\n')
    expect(readFileSync(join(root, 'settings.yaml'), 'utf8')).toContain('duplicate: 2')
  })

  it('creates per-invocation empty Session and storage roots for diagnostic mode', () => {
    const root = home()
    const first = prepareDiagnosticRuntimeDirectories(root)
    const second = prepareDiagnosticRuntimeDirectories(root)
    expect(first.root).not.toBe(second.root)
    expect(first.sessions).toBe(join(first.root, 'sessions'))
    expect(first.storages).toBe(join(first.root, 'storages'))
    expect(existsSync(first.sessions)).toBe(true)
    expect(existsSync(first.storages)).toBe(true)
    expect(first.root).not.toContain(join(root, 'sessions'))
    expect(first.root).not.toContain(join(root, 'storages'))
  })

  it('preserves exact invalid bytes before resetting the active document', () => {
    const root = home()
    const original = 'duplicate: 1\r\nduplicate: 2\r\n'
    writeFileSync(join(root, 'settings.yaml'), original)
    const result = backupAndResetInvalidSettings(root, () => new Date('2026-09-02T08:00:00.000Z'))
    expect(result.backupName).toBe('settings.before-reset.2026-09-02T08-00-00-000Z.yaml')
    expect(readFileSync(result.backupPath!, 'utf8')).toBe(original)
    expect(readFileSync(result.documentPath, 'utf8')).toBe('{}\n')
  })

  it('refuses to follow a settings symlink', () => {
    const root = home()
    const outside = join(root, 'outside.yaml')
    writeFileSync(outside, 'keep: true\n')
    symlinkSync(outside, join(root, 'settings.yaml'))
    expect(() => backupAndResetInvalidSettings(root)).toThrow(/symbolic-link/u)
    expect(existsSync(outside)).toBe(true)
  })
})
