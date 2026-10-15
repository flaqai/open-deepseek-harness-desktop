import { describe, expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionFormatArtifact, SessionFormatHeader } from '@deepseek-ai/dsh-session-format'
import {
  validateInstalledCurrentSessionArtifact,
  validateInstalledCurrentSessionHeader,
} from '../src/current.ts'
import { createSessionFormatCatalogWithChildren } from '../src/index.ts'

const currentHeader: SessionFormatHeader = {
  version: SESSION_FORMAT_VERSION,
  id: 'installed-current',
  createdAt: 1,
  isSeeded: false,
  delegationDepth: 0,
}

describe('installed current Session restoration', () => {
  it.each([
    { kind: 'user', rpcId: 'old-owner-request' },
    { kind: 'user', rpcId: 'explicit-owner-request', principal: { kind: 'owner' } },
    { kind: 'user', rpcId: 'nas-request', principal: { kind: 'nas', deviceId: 'historical-device' } },
    { kind: 'user', rpcId: 'future-request', principal: { kind: 'future-driver', opaqueId: 'not-an-owner' } },
  ])('restores user source attribution verbatim without promoting its principal: $rpcId', (source) => {
    const reader = createSessionFormatCatalogWithChildren([]).createRestore({
      ...currentHeader, type: 'session',
    }, { recovery: 'strict', validation: 'current' })
    const row = {
      type: 'user/message', seq: 0, time: 1, surfaceOp: 'append',
      data: { id: 'user-attribution', role: 'user', source, content: [{ type: 'text', text: 'historical prompt' }] },
    }
    const original = JSON.stringify(row)
    reader.decodeRow(row)
    const restored = reader.finish()
    expect(restored.events[0]?.data).toMatchObject({ source })
    expect(JSON.stringify(row)).toBe(original)
    const result = restored.events[0]?.data as { source: typeof source }
    expect(result.source).toEqual(source)
    if ('principal' in source && source.principal?.kind !== 'owner') {
      expect(result.source.principal?.kind).not.toBe('owner')
    }
  })

  it('rejects version skew before entering current Session validation', () => {
    expect(() => { validateInstalledCurrentSessionHeader({ ...currentHeader, version: 0 }) })
      .toThrow(`installed Session format is v${SESSION_FORMAT_VERSION}, got v0`)
    const artifact: SessionFormatArtifact = {
      header: { ...currentHeader, version: 0 },
      inheritedEventCount: 0,
      events: [],
    }
    expect(() => { validateInstalledCurrentSessionArtifact(artifact) })
      .toThrow(`installed Session format is v${SESSION_FORMAT_VERSION}, got v0`)
  })

  it('accepts only current request-header reasons and the true starts-series marker', () => {
    const artifact = (reason: string, startsSeries?: boolean): SessionFormatArtifact => ({
      header: { ...currentHeader },
      inheritedEventCount: 0,
      events: [
        { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
        {
          type: 'request/header', seq: 1, time: 2,
          data: {
            header: { config: { provider: 'mock', model: 'mock' } },
            reason,
            ...(startsSeries === undefined ? {} : { startsSeries }),
          },
        },
      ],
    })

    expect(() => { validateInstalledCurrentSessionArtifact(artifact('fallback')) })
      .toThrow(/request\/header.*reason/)
    expect(() => { validateInstalledCurrentSessionArtifact(artifact('initial', false)) })
      .toThrow(/startsSeries/)
    expect(() => { validateInstalledCurrentSessionArtifact(artifact('series', true)) }).not.toThrow()
  })
})
