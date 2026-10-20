import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BundledPresetVersionGate } from '../src/bundled-preset-version-gate.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function gate(): Promise<{ home: string; gate: BundledPresetVersionGate }> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-preset-version-'))
  roots.push(home)
  return { home, gate: new BundledPresetVersionGate(home) }
}

describe('bundled preset version gate', () => {
  it('permits bounded retries across application instances without downgrading', async () => {
    const { home, gate: current } = await gate()
    expect(await current.shouldAttempt('0.1.5-rc.2.3')).toBe(true)
    await current.markAttempted('0.1.5-rc.2.3')
    expect(await new BundledPresetVersionGate(home).shouldAttempt('0.1.5-rc.2.3')).toBe(true)
    expect(await current.shouldAttempt('0.1.6-alpha.2.1')).toBe(true)
    await current.markAttempted('0.1.6-alpha.2.1')
    expect(await current.shouldAttempt('0.1.6-alpha.2.1')).toBe(true)
    expect(await current.shouldAttempt('0.1.5-rc.2.3')).toBe(false)
  })

  it('stops after three incomplete attempts and exposes exhaustion until a newer version', async () => {
    const { home, gate: current } = await gate()
    await current.markAttempted('0.1.6-alpha.2.1')
    expect(await new BundledPresetVersionGate(home).shouldAttempt('0.1.6-alpha.2.1')).toBe(true)
    await new BundledPresetVersionGate(home).markAttempted('0.1.6-alpha.2.1')
    await new BundledPresetVersionGate(home).markAttempted('0.1.6-alpha.2.1')
    expect(await current.shouldAttempt('0.1.6-alpha.2.1')).toBe(false)
    expect(await current.retryExhausted('0.1.6-alpha.2.1')).toBe(true)
    await expect(current.markAttempted('0.1.6-alpha.2.1')).rejects.toThrow(/exhausted/)
    expect(await current.shouldAttempt('0.1.6-alpha.2.2')).toBe(true)
    expect(await current.retryExhausted('0.1.6-alpha.2.2')).toBe(false)
    await current.markAttempted('0.1.6-alpha.2.2')
    expect(await current.shouldAttempt('0.1.6-alpha.2.2')).toBe(true)
  })

  it('stops retrying only after completion and permits a later desktop upgrade', async () => {
    const { home, gate: current } = await gate()
    await current.markAttempted('0.2.1-rc.2')
    await current.markCompleted('0.2.1-rc.2')
    expect(await new BundledPresetVersionGate(home).shouldAttempt('0.2.1-rc.2')).toBe(false)
    expect(await current.retryExhausted('0.2.1-rc.2')).toBe(false)
    expect(await current.shouldAttempt('0.2.1-rc.3')).toBe(true)
    await expect(current.markAttempted('0.2.1-rc.1')).rejects.toThrow(/downgrade/)
    await expect(current.markCompleted('0.2.1-rc.1')).rejects.toThrow(/downgrade/)
    await expect(current.markAttempted('0.2.1-rc.2')).rejects.toThrow(/completed/)
  })

  it('can record successful first-start provisioning without a preceding attempt', async () => {
    const { gate: current } = await gate()
    await current.markCompleted('0.2.1-rc.2')
    expect(await current.shouldAttempt('0.2.1-rc.2')).toBe(false)
    await current.markCompleted('0.2.1-rc.2')
    expect(await current.shouldAttempt('0.2.1-rc.2')).toBe(false)
  })

  it('migrates schema 1 attempted-only markers without treating them as completion', async () => {
    const { home, gate: current } = await gate()
    await current.markAttempted('0.2.1-rc.2')
    const marker = join(home, 'bundled-plugins', 'desktop-preset-attempt.v1.json')
    await writeFile(marker, JSON.stringify({ schema: 1, attemptedVersion: '0.2.1-rc.2' }))
    expect(await current.shouldAttempt('0.2.1-rc.2')).toBe(true)
    expect(await current.shouldAttempt('0.2.1-rc.1')).toBe(false)
    await current.markAttempted('0.2.1-rc.2')
    expect(JSON.parse(await readFile(marker, 'utf8'))).toEqual({
      schema: 2, attemptedVersion: '0.2.1-rc.2', attemptCount: 2, completed: false,
    })
    await current.markAttempted('0.2.1-rc.2')
    expect(await current.retryExhausted('0.2.1-rc.2')).toBe(true)
  })

  it('rejects a damaged marker rather than silently repeating preparation', async () => {
    const { home, gate: current } = await gate()
    await current.markAttempted('0.1.5-rc.2.3')
    await writeFile(join(home, 'bundled-plugins', 'desktop-preset-attempt.v1.json'), '{ damaged')
    await expect(current.shouldAttempt('0.1.6-alpha.2.1')).rejects.toThrow(/invalid.*marker/i)
  })

  it('stores only the version, with no Profile or command content', async () => {
    const { home, gate: current } = await gate()
    await current.markAttempted('0.1.6-alpha.2.1')
    const marker = await readFile(join(home, 'bundled-plugins', 'desktop-preset-attempt.v1.json'), 'utf8')
    expect(JSON.parse(marker)).toEqual({
      schema: 2, attemptedVersion: '0.1.6-alpha.2.1', attemptCount: 1, completed: false,
    })
  })

  it.each([
    { schema: 1, attemptedVersion: '0.2.1-rc.2', unexpected: true },
    { schema: 2, attemptedVersion: '0.2.1-rc.2', attemptCount: 1, completed: false, unexpected: true },
    { schema: 2, attemptedVersion: '0.2.1-rc.2', attemptCount: 4, completed: false },
    { schema: 2, attemptedVersion: '0.2.1-rc.2', attemptCount: 0, completed: false },
    { schema: 2, attemptedVersion: '0.2.1-rc.2', attemptCount: 1.5, completed: false },
    { schema: 2, attemptedVersion: 'invalid', attemptCount: 1, completed: false },
    { schema: 2, attemptedVersion: '0.2.1-rc.2', attemptCount: 1, completed: 'yes' },
  ])('rejects invalid or unrelated marker fields: %j', async (record) => {
    const { home, gate: current } = await gate()
    await current.markAttempted('0.2.1-rc.2')
    const marker = join(home, 'bundled-plugins', 'desktop-preset-attempt.v1.json')
    const source = JSON.stringify(record)
    await writeFile(marker, source)
    await expect(current.shouldAttempt('0.2.1-rc.2')).rejects.toThrow(/invalid.*marker/)
    await expect(current.markAttempted('0.2.1-rc.2')).rejects.toThrow(/invalid.*marker/)
    await expect(current.markCompleted('0.2.1-rc.2')).rejects.toThrow(/invalid.*marker/)
    expect(await readFile(marker, 'utf8')).toBe(source)
  })
})
