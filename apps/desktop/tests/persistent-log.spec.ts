import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  formatPersistentLogLine,
  preparePersistentLog,
  redactPersistentLogText,
  startDesktopLogSession,
  TimestampedLogWriter,
} from '../src/persistent-log.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('persistent Desktop diagnostic log', () => {
  it('timestamps split process output and redacts credential forms', () => {
    const lines: string[] = []
    const writer = new TimestampedLogWriter(
      (line) => { lines.push(line) },
      'harness-stderr',
      'error',
      () => new Date('2026-09-15T08:00:00.000Z'),
    )
    const unicode = Buffer.from(' 中文')
    writer.write(Buffer.concat([Buffer.from('first line\nsecond'), unicode.subarray(0, 2)]))
    writer.write(Buffer.concat([unicode.subarray(2), Buffer.from(' line token=private-value\npartial')]))
    writer.flush()

    expect(lines).toEqual([
      '[2026-09-15T08:00:00.000Z] [harness-stderr] [error] first line\n',
      '[2026-09-15T08:00:00.000Z] [harness-stderr] [error] second 中文 line token=[REDACTED]\n',
      '[2026-09-15T08:00:00.000Z] [harness-stderr] [error] partial\n',
    ])
    expect(redactPersistentLogText('https://name:secret@example.com/?api_key=value'))
      .toBe('https://name:[REDACTED]@example.com/?api_key=[REDACTED]')
    expect(formatPersistentLogLine('desktop', 'warn', 'message\n', new Date('2026-09-15T08:00:00.000Z')))
      .toBe('[2026-09-15T08:00:00.000Z] [desktop] [warn] message\n')
  })

  it('rotates only an oversized log and preserves bounded restart history', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-persistent-log-'))
    roots.push(root)
    const path = join(root, 'harness.log')
    writeFileSync(path, 'current')
    writeFileSync(`${path}.1`, 'previous')
    writeFileSync(`${path}.2`, 'oldest')

    preparePersistentLog(path, { maxBytes: 2, backups: 2 })

    expect(readFileSync(`${path}.1`, 'utf8')).toBe('current')
    expect(readFileSync(`${path}.2`, 'utf8')).toBe('previous')
  })

  it('appends separate process sessions across restarts and captures console errors', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-persistent-log-session-'))
    roots.push(root)
    const path = join(root, 'harness.log')
    const metadata = {
      version: '0.1.5-rc.2.2', platform: process.platform, architecture: process.arch,
      packaged: false, pid: 123,
    }
    const first = startDesktopLogSession(path, { ...metadata, sessionId: 'first' })
    try {
      console.error('failed Authorization: Bearer private-token')
    } finally {
      first.close('test-restart')
    }
    const second = startDesktopLogSession(path, { ...metadata, sessionId: 'second' })
    second.close('test-complete')

    const log = readFileSync(path, 'utf8')
    expect(log).toContain('session started id=first')
    expect(log).toContain('session ended reason=test-restart')
    expect(log).toContain('session started id=second')
    expect(log).toContain('failed Authorization: [REDACTED]')
    expect(log).not.toContain('private-token')
  })
})
