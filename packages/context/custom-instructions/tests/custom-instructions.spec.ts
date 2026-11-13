import { renderCustomInstruction } from '../src/prompt.ts'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { SystemPrompt, renderContextSections } from '@deepseek-ai/dsh-system-prompt'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { updateVolatile } from '@deepseek-ai/cosmokit'
import { apply, Config } from '../src/index.ts'

describe('custom instructions', () => {
  it('renders attributed immutable revisions and disables blank content', () => {
    expect(renderCustomInstruction('global', { id: 'v1', text: 'Answer briefly.', createdAt: 1 }))
      .toBe('<custom-instructions scope="global" version="v1">\nAnswer briefly.\n</custom-instructions>')
    expect(renderCustomInstruction('global', { id: 'v2', text: '  ', createdAt: 2 })).toBe('')
  })

  it('injects global before matching Workspace instructions and reads saved changes live', async () => {
    const ctx = new Context()
    const workspaceId = WorkspaceId('workspace-1')
    const config = Config({
      global: { activeVersion: 'g1', versions: [{ id: 'g1', text: 'Global.', createdAt: 1 }] },
      workspaces: { [workspaceId]: { activeVersion: 'p1', versions: [{ id: 'p1', text: 'Project.', createdAt: 2 }] } },
      diagnosticExport: { preference: 'ask' },
    })
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(AgentRegistry)
    ctx.provide('workspaceRegistry', {
      list: () => [{ id: workspaceId, path: '/project' }],
    } as never)
    apply(ctx, config)
    const agent = { session: { header: { cwd: '/project' } }, ctx } as never
    await ctx.serial('agent/created', { agent, source: 'startup' })
    const sections = renderContextSections(await ctx.systemPrompt.assemble())
    expect(sections.map(section => section.name)).toEqual([
      'custom-instructions:global',
      'custom-instructions:workspace',
    ])
    expect(sections.map(section => section.text)).toEqual([
      '<custom-instructions scope="global" version="g1">\nGlobal.\n</custom-instructions>',
      `<custom-instructions scope="workspace:${workspaceId}" version="p1">\nProject.\n</custom-instructions>`,
    ])
    updateVolatile(config.global, Config({ global: { activeVersion: 'g2', versions: [
      { id: 'g2', text: 'Updated.', createdAt: 3 },
    ] } }).global)
    expect(renderContextSections(await ctx.systemPrompt.assemble())[0]?.text)
      .toBe('<custom-instructions scope="global" version="g2">\nUpdated.\n</custom-instructions>')
  })
})
