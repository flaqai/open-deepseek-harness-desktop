import { describe, expect, it } from 'vitest'
import { summarizeProfileRecoveryFailure } from '../src/profile-recovery-diagnostic.ts'

describe('Profile recovery failure evidence', () => {
  it('preserves the missing archive and blocked operation without exposing credentials or home paths', () => {
    const cause = Object.assign(new Error('[ERR_PNPM_TARBALL_READ_LOCAL_TARBALL] Cannot read local tarball "D:\\App\\resources\\bundled-plugins\\dshmarket-1.55.0.tgz": ENOENT token=private'), { code: 'ENOENT', kind: 'bundled-plugin-install:@scope/bridge', operationId: 'operation-123' })
    const result = summarizeProfileRecoveryFailure(new Error('rollback failed', { cause }), { home: 'D:\\Home', operation: 'bundled-plugin:@scope/bridge' })
    expect(result.category).toBe('missing-local-archive')
    expect(result.missingArchive).toBe('dshmarket-1.55.0.tgz')
    expect(result.blockedPackage).toBe('@scope/bridge')
    expect(result.causes[1]).toMatchObject({ code: 'ENOENT', operationId: 'operation-123' })
    expect(JSON.stringify(result)).not.toContain('token=private')
    expect(JSON.stringify(result)).not.toContain('D:\\App')
  })

  it.each(['DESKTOP_MISSING_LOCAL_ARCHIVE', 'desktop.plugin-archive-missing'])('recognizes typed source-preflight error %s', (code) => {
    const error = Object.assign(new Error('Local archive unavailable'), {
      code, missingArchive: 'D:\\Old\\market-1.0.0.tgz', packageName: 'market', phase: 'source-preflight',
    })
    const result = summarizeProfileRecoveryFailure(error, { home: 'D:\\Home' })
    expect(result).toMatchObject({ category: 'missing-local-archive', missingArchive: 'market-1.0.0.tgz', rootPackage: 'market' })
    expect(result.causes[0]).toMatchObject({ phase: 'source-preflight' })
    expect(JSON.stringify(result)).not.toContain('D:\\Old')
  })

  it('collects original and rollback errors from aggregate failures', () => {
    const original = Object.assign(new Error('install failed'), { kind: 'bundled-plugin-install:bridge' })
    const rollback = new Error('[ERR_PNPM_TARBALL_READ_LOCAL_TARBALL] Cannot read local tarball "D:\\App\\market-1.0.0.tgz": ENOENT')
    const result = summarizeProfileRecoveryFailure(new AggregateError([original, rollback], 'transaction failed'), { home: 'D:\\Home' })
    expect(result.causes).toHaveLength(3)
    expect(result.category).toBe('missing-local-archive')
    expect(result.blockedPackage).toBe('bridge')
    expect(result.missingArchive).toBe('market-1.0.0.tgz')
  })

  it('bounds cyclic cause chains and redacts URL credentials and bearer values', () => {
    const error = new Error('https://user:password@host/a?token=secret Authorization: Bearer hidden /home/person/config')
    Object.defineProperty(error, 'cause', { value: error })
    const result = summarizeProfileRecoveryFailure(error, { home: '/home/person' })
    expect(result.causes).toHaveLength(1)
    const text = JSON.stringify(result)
    for (const secret of ['password', 'secret', 'hidden', '/home/person']) expect(text).not.toContain(secret)
  })
})
