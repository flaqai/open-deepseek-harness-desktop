import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InstallProgressTracker, redactInstallOutput } from '../src/install-progress.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

function progressFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-install-progress-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'progress.ndjson')
  writeFileSync(path, '')
  return path
}

function record(name: string, value: Record<string, unknown>): string {
  return `${JSON.stringify({ name, ...value })}\n`
}

describe('InstallProgressTracker', () => {
  it('parses partial UTF-8 NDJSON and computes acquired dependency progress', () => {
    const path = progressFile()
    const tracker = new InstallProgressTracker(64 * 1024)
    const stage = Buffer.from(record('pnpm:stage', { stage: 'resolution_started', message: '解析依赖' }))
    writeFileSync(path, stage.subarray(0, stage.byteLength - 2))
    tracker.refresh(path)
    expect(tracker.progress).toEqual({ stage: 'preparing' })

    appendFileSync(path, stage.subarray(stage.byteLength - 2))
    appendFileSync(path, [
      record('pnpm:progress', { status: 'resolved' }),
      record('pnpm:progress', { status: 'resolved' }),
      record('pnpm:stage', { stage: 'resolution_done' }),
      record('pnpm:progress', { status: 'found_in_store' }),
    ].join(''))
    tracker.refresh(path)
    expect(tracker.progress).toEqual({ stage: 'downloading', percent: 50, completed: 1, total: 2 })
    expect(tracker.read(0, false).text).toContain('Resolving dependencies')
  })

  it('resets determinate counts when Windows starts another attempt', () => {
    const path = progressFile()
    const tracker = new InstallProgressTracker(64 * 1024)
    appendFileSync(path, [
      record('pnpm:progress', { status: 'resolved' }),
      record('pnpm:stage', { stage: 'resolution_done' }),
      record('pnpm:progress', { status: 'fetched' }),
      record('dsh:install-progress', { stage: 'retrying', message: 'retrying' }),
      record('dsh:install-progress', { stage: 'attempt-started', attempt: 2 }),
    ].join(''))
    tracker.refresh(path)
    expect(tracker.progress).toEqual({ stage: 'preparing' })
    expect(tracker.read(0, false).text).toContain('Starting download attempt 2')
  })

  it('keeps determinate progress visible while pnpm imports cached or downloaded dependencies', () => {
    const path = progressFile()
    const tracker = new InstallProgressTracker(64 * 1024)
    appendFileSync(path, [
      record('pnpm:progress', { status: 'resolved' }),
      record('pnpm:progress', { status: 'resolved' }),
      record('pnpm:progress', { status: 'found_in_store' }),
      record('pnpm:stage', { stage: 'resolution_done' }),
      record('pnpm:stage', { stage: 'importing_started' }),
      record('pnpm:progress', { status: 'imported' }),
    ].join(''))
    tracker.refresh(path)

    expect(tracker.progress).toEqual({ stage: 'installing', percent: 50, completed: 1, total: 2 })
    expect(tracker.read(0, false).text).toContain('dependencies ready (50%)')
    expect(tracker.read(0, false).text).toContain('dependencies installed (50%)')
  })

  it('returns incremental output and marks cursors that fell behind the retained cap', () => {
    const path = progressFile()
    const tracker = new InstallProgressTracker(48)
    appendFileSync(path, 'first diagnostic line\nsecond diagnostic line\n')
    tracker.refresh(path)
    const first = tracker.read(0, false)
    expect(first.text).toContain('first diagnostic line')
    appendFileSync(path, 'third diagnostic line that evicts older output\n')
    tracker.refresh(path)
    const delta = tracker.read(first.nextOffset, true)
    expect(delta.text).toContain('third diagnostic line')
    expect(delta.settled).toBe(true)
    const retained = tracker.read(0, true)
    expect(retained.lossy).toBe(true)
    expect(Buffer.byteLength(retained.text)).toBeLessThanOrEqual(48)
  })

  it('redacts credentials before retaining terminal output', () => {
    const tracker = new InstallProgressTracker(64 * 1024)
    tracker.appendDiagnostic([
      'https://alice:secret@example.test/pkg.tgz?token=abc123',
      'Authorization: Bearer secret-token',
      'npm_config_authToken=private-value',
      '//registry.npmjs.org/:_authToken=npm-secret',
      'NPM_TOKEN=environment-secret',
    ].join('\n'))
    const output = tracker.read(0, true).text
    expect(output).not.toContain('secret')
    expect(output).not.toContain('abc123')
    expect(output).not.toContain('private-value')
    expect(output).not.toContain('npm-secret')
    expect(output).not.toContain('environment-secret')
    expect(output).toContain('[redacted]')
    expect(redactInstallOutput('password=hunter2')).toBe('password=[redacted]')
  })
})
