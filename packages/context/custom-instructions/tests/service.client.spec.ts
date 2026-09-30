import { describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CustomInstructionSettings } from '../src/types.ts'
import { createCustomInstructionsClient } from '../src/client/service.ts'

function bench() {
  let value: CustomInstructionSettings = {
    global: { versions: [] },
    workspaces: {},
    diagnosticExport: { preference: 'ask' },
  }
  let revision = 1
  const mutate = vi.fn<ConfigForm<CustomInstructionSettings>['mutate']>(async (ops) => {
    for (const op of ops) {
      if (op.path[0] === 'global' && op.op === 'set') value = { ...value, global: op.value as never }
      if (op.path[0] === 'workspaces' && op.path[1] !== undefined) {
        const workspaceId = op.path[1]
        const workspaces = op.op === 'unset'
          ? Object.fromEntries(Object.entries(value.workspaces).filter(([id]) => id !== workspaceId))
          : { ...value.workspaces, [workspaceId]: op.value as never }
        value = { ...value, workspaces }
      }
      if (op.path.join('.') === 'diagnosticExport.preference' && op.op === 'set') {
        value = { ...value, diagnosticExport: { preference: op.value as never } }
      }
    }
    revision += 1
    return true
  })
  const snapshot = (): ConfigFormSnapshot<CustomInstructionSettings> => ({
    status: 'ready', value, base: undefined, user: value, revision, writable: true, mode: 'host',
  })
  const scope: ConfigForm<CustomInstructionSettings> = {
    getSnapshot: snapshot,
    subscribe: () => () => {},
    mutate,
    set: vi.fn(async () => true),
    unset: vi.fn(async () => true),
  }
  const open = vi.fn()
  const client = createCustomInstructionsClient(scope, { open } as never)
  return { client, mutate, open, value: () => value }
}

describe('custom instruction editor service', () => {
  it('creates immutable global and Workspace revisions and deduplicates unchanged saves', async () => {
    const b = bench()
    await b.client.save('global', '  Global guidance.  ')
    const global = b.value().global
    expect(global.versions).toHaveLength(1)
    expect(global.versions[0]?.text).toBe('Global guidance.')
    await b.client.save('global', 'Global guidance.')
    expect(b.mutate).toHaveBeenCalledTimes(1)

    await b.client.save('workspace-1' as never, 'Project guidance.')
    expect(b.value().workspaces['workspace-1']?.versions[0]?.text).toBe('Project guidance.')
    await b.client.save('workspace-1' as never, '')
    expect(b.value().workspaces['workspace-1']?.activeVersion).toBeUndefined()
    expect(b.value().workspaces['workspace-1']?.versions).toHaveLength(1)
  })

  it('opens the correct subsection and removes editor history after Workspace deletion', async () => {
    const b = bench()
    b.client.openGlobal()
    b.client.openWorkspace('workspace-2' as never)
    expect(b.open).toHaveBeenNthCalledWith(1, { sectionId: 'custom-instructions', subsectionId: 'global' })
    expect(b.open).toHaveBeenNthCalledWith(2, { sectionId: 'custom-instructions', subsectionId: 'workspace:workspace-2' })
    await b.client.save('workspace-2' as never, 'Private project prompt')
    await b.client.workspaceDeleted('workspace-2' as never)
    expect(b.value().workspaces['workspace-2']).toBeUndefined()
  })

  it('remembers either diagnostic-export choice exactly', async () => {
    const b = bench()
    await b.client.setDiagnosticExportPreference('include')
    expect(b.value().diagnosticExport.preference).toBe('include')
    await b.client.setDiagnosticExportPreference('exclude')
    expect(b.value().diagnosticExport.preference).toBe('exclude')
  })
})
