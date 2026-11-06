import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceViewStore } from '../src/client/stores.ts'

const key = 'dsh.workspace.view.v5'
const diagnosticKey = `${key}.recovery`
const defaults = {
  groupBy: 'workspace', orderBy: 'updated', groupExpansion: {},
  sessionOrderByAccount: {}, archivedFilter: 'default',
}

function storage(raw: string) {
  const data = new Map([[key, raw]])
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => data.get(name) ?? null,
    setItem: (name: string, value: string) => { data.set(name, value) },
    removeItem: (name: string) => { data.delete(name) },
  })
  return data
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Workspace viewing preference hydration', () => {
  it.each([
    ['missing expansion', { ...defaults, groupExpansion: undefined }],
    ['missing orders', { ...defaults, sessionOrderByAccount: undefined }],
    ['null root', null],
    ['array root', []],
    ['array records', { ...defaults, groupExpansion: [], sessionOrderByAccount: [] }],
  ])('recovers %s before rendering or actions read the records', (_name, value) => {
    const raw = JSON.stringify(value)
    const data = storage(raw)
    const report = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const instance = createWorkspaceViewStore().create()
    expect(instance.getSnapshot()).toEqual(defaults)
    expect(data.get(key)).toBe(raw)
    expect(() => {
      instance.actions.retainAccountKeys(['workspace'])
      instance.actions.setGroupExpanded('workspace', true)
      instance.actions.setSessionOrder('workspace', ['session'], {})
    }).not.toThrow()
    expect(report).toHaveBeenCalledTimes(1)
    expect(data.has(diagnosticKey)).toBe(true)
  })

  it('preserves valid preferences and entries while discarding malformed values without exposing them', () => {
    const value = {
      groupBy: 'workspace-tree', orderBy: 'manual', archivedFilter: 'show',
      groupExpansion: { 'private-workspace': true, 'secret-path': 'invalid' },
      sessionOrderByAccount: { 'private-workspace': ['private-session', null, 7, 'other-session'], broken: null },
    }
    const raw = JSON.stringify(value)
    const data = storage(raw)
    const report = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const instance = createWorkspaceViewStore().create()
    expect(instance.getSnapshot()).toEqual({
      groupBy: 'workspace-tree', orderBy: 'manual', archivedFilter: 'show',
      groupExpansion: { 'private-workspace': true },
      sessionOrderByAccount: { 'private-workspace': ['private-session', 'other-session'] },
    })
    expect(data.get(key)).toBe(raw)
    const diagnostic = data.get(diagnosticKey) ?? ''
    expect(diagnostic).toContain('groupExpansion')
    expect(diagnostic).toContain('sessionOrderByAccount')
    for (const secret of ['private-workspace', 'secret-path', 'private-session', 'other-session', 'broken']) {
      expect(diagnostic).not.toContain(secret)
      expect(JSON.stringify(report.mock.calls)).not.toContain(secret)
    }
    instance.actions.setGroupBy('flat')
    expect(JSON.parse(data.get(key)!)).toEqual({ ...instance.getSnapshot() })
  })

  it('defaults invalid enums and tolerates an older v5 snapshot without the archived filter', () => {
    storage(JSON.stringify({ ...defaults, groupBy: 'bad', orderBy: false, archivedFilter: 'bad' }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(createWorkspaceViewStore().create().getSnapshot()).toEqual(defaults)
    const data = storage(JSON.stringify({ ...defaults, archivedFilter: undefined }))
    expect(createWorkspaceViewStore().create().getSnapshot()).toEqual(defaults)
    expect(data.has(diagnosticKey)).toBe(false)
  })

  it('recovers malformed JSON without copying its text into diagnostics', () => {
    const raw = '{"private-session-content":'
    const data = storage(raw)
    const report = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(createWorkspaceViewStore().create().getSnapshot()).toEqual(defaults)
    expect(data.get(key)).toBe(raw)
    expect(data.get(diagnosticKey)).not.toContain('private-session-content')
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('keeps recovery usable when writing its single diagnostic record fails', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => 'null',
      setItem: () => { throw new Error('private storage failure') },
    })
    const report = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(createWorkspaceViewStore().create().getSnapshot()).toEqual(defaults)
    expect(JSON.stringify(report.mock.calls)).not.toContain('private storage failure')
  })
})
