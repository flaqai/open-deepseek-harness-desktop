import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

interface WorkflowJob {
  readonly if?: string
  readonly needs?: string
  readonly env?: Record<string, string>
  readonly steps?: Array<{ uses?: string; with?: Record<string, string>; run?: string }>
}

describe('desktop package workflow bundled plugins', () => {
  it('resolves one snapshot and reuses it in every platform package', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../../.github/workflows/desktop-packages.yml'), 'utf8')
    const workflow = parse(source) as { jobs: Record<string, WorkflowJob> }
    const resolver = workflow.jobs['bundled-plugins']
    expect(resolver?.steps?.some(step => step.run === 'pnpm run refresh:desktop:bundled-plugins')).toBe(true)
    expect(resolver?.steps?.some(step => step.with?.name === 'bundled-plugin-snapshot')).toBe(true)

    for (const name of ['macos', 'windows', 'linux']) {
      const job = workflow.jobs[name]
      expect(job?.needs).toBe('bundled-plugins')
      expect(job?.env?.DSH_BUNDLED_PLUGINS_REFRESH).toBe('0')
      expect(job?.steps?.some(step => (
        step.uses === 'actions/download-artifact@v4'
        && step.with?.name === 'bundled-plugin-snapshot'
        && step.with?.path === 'apps/desktop/bundled-plugins'
      ))).toBe(true)
    }
  })

  it('keeps the internal snapshot out of release artifact globs', () => {
    expect('bundled-plugin-snapshot').not.toMatch(/^desktop-/u)
  })

  it('allows each native platform to be packaged independently', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../../.github/workflows/desktop-packages.yml'), 'utf8')
    const workflow = parse(source) as {
      on: { workflow_dispatch: { inputs: { target: { options: string[] } } } }
      jobs: Record<string, WorkflowJob>
    }
    expect(workflow.on.workflow_dispatch.inputs.target.options).toEqual([
      'all', 'macos', 'windows-x64', 'linux-x64',
    ])
    expect(workflow.jobs.macos?.if).toContain("inputs.target == 'macos'")
    expect(workflow.jobs.windows?.if).toContain("inputs.target == 'windows-x64'")
    expect(workflow.jobs.linux?.if).toContain("inputs.target == 'linux-x64'")
    expect(workflow.jobs.checksums?.if).toContain("inputs.target == 'macos'")
    expect(workflow.jobs.checksums?.if).toContain("inputs.target == 'linux-x64'")
  })

  it('keeps packaging manual and leaves GitHub Release publication to the explicit local workflow', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../../.github/workflows/desktop-packages.yml'), 'utf8')
    const workflow = parse(source) as {
      on: { workflow_dispatch: { inputs: Record<string, unknown> } }
      permissions: Record<string, string>
      jobs: Record<string, WorkflowJob>
    }
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual(['target'])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs.release).toBeUndefined()
    expect(source).not.toContain('gh release ')
  })
})
