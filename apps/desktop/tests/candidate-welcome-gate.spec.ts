import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { CandidateWelcomeGate } from '../src/candidate-welcome-gate.ts'

describe('candidate welcome gate', () => {
  it('uses transaction readiness after candidate selection has been cleared for activation', async () => {
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    const call = main.match(/candidateWelcomeGate\.serverReady\(([^\n]+), \{/u)?.[1]
    expect(call).toBe('url, desktopMutations.awaitingReadiness')
  })

  it('loads the Harness client for first-start verification before opening welcome', async () => {
    const events: string[] = []
    const gate = new CandidateWelcomeGate()
    await gate.serverReady('http://127.0.0.1:1234/', true, {
      loadClient: async (url) => { events.push(`client:${url}`) },
      openWelcome: async (url) => { events.push(`welcome:${url}`) },
    })
    expect(events).toEqual(['client:http://127.0.0.1:1234/'])
    await gate.committed(async (url) => { events.push(`welcome:${url}`) })
    expect(events).toEqual(['client:http://127.0.0.1:1234/', 'welcome:http://127.0.0.1:1234/'])
  })

  it('opens welcome immediately without a candidate and never reopens it on commit', async () => {
    const events: string[] = []
    const gate = new CandidateWelcomeGate()
    await gate.serverReady('http://127.0.0.1:1234/', false, {
      loadClient: async () => { events.push('client') },
      openWelcome: async () => { events.push('welcome') },
    })
    await gate.committed(async () => { events.push('late-welcome') })
    expect(events).toEqual(['welcome'])
  })

  it('discards the pending welcome after rollback', async () => {
    const events: string[] = []
    const gate = new CandidateWelcomeGate()
    await gate.serverReady('http://127.0.0.1:1234/', true, {
      loadClient: async () => { events.push('client') },
      openWelcome: async () => { events.push('early-welcome') },
    })
    gate.rolledBack()
    await gate.committed(async () => { events.push('late-welcome') })
    expect(events).toEqual(['client'])
  })
})
