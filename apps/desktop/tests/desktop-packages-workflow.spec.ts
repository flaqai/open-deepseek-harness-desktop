import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

interface WorkflowJob {
  readonly if?: string
  readonly needs?: string | string[]
  readonly env?: Record<string, string>
  readonly steps?: Array<{ name?: string; if?: string; uses?: string; with?: Record<string, string>; run?: string; 'continue-on-error'?: boolean }>
}

function readWorkflow() {
  const source = readFileSync(resolve(import.meta.dirname, '../../../.github/workflows/desktop-packages.yml'), 'utf8')
  return {
    source,
    workflow: parse(source) as {
      'run-name': string
      on: { workflow_dispatch: { inputs: Record<string, unknown> } }
      jobs: Record<string, WorkflowJob>
    },
  }
}

describe('desktop package workflow bundled plugins', () => {
  it('runs the packaged-resource contract before native packaging starts', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../../.github/workflows/desktop-packages.yml'), 'utf8')
    const workflow = parse(source) as { jobs: Record<string, WorkflowJob> }
    const resolver = workflow.jobs['bundled-plugins']
    const contractCheck = resolver?.steps?.findIndex(step => step.name === 'Verify package resource contract') ?? -1
    const refresh = resolver?.steps?.findIndex(step => step.run === 'pnpm run refresh:desktop:bundled-plugins') ?? -1
    expect(contractCheck).toBeGreaterThanOrEqual(0)
    expect(contractCheck).toBeLessThan(refresh)
    expect(resolver?.steps?.[contractCheck]?.run).toContain('packaged-resource-contract.test.mjs')
  })

  it('prepares pnpm before every job step that invokes it', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../../.github/workflows/desktop-packages.yml'), 'utf8')
    const workflow = parse(source) as { jobs: Record<string, WorkflowJob> }
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      const pnpmSetup = job.steps?.findIndex(step => step.uses === 'pnpm/action-setup@v4') ?? -1
      for (const [stepIndex, step] of (job.steps ?? []).entries()) {
        if (!step.run?.match(/(?:^|\s)pnpm(?:\s|$)/u)) continue
        expect(pnpmSetup, `${jobName} must set up pnpm`).toBeGreaterThanOrEqual(0)
        expect(pnpmSetup, `${jobName} must set up pnpm before ${step.name ?? step.run}`).toBeLessThan(stepIndex)
      }
    }
  })

  it('resolves one snapshot and reuses it in every platform package', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../../.github/workflows/desktop-packages.yml'), 'utf8')
    const workflow = parse(source) as { jobs: Record<string, WorkflowJob> }
    const resolver = workflow.jobs['bundled-plugins']
    expect(resolver?.steps?.some(step => step.run === 'pnpm run refresh:desktop:bundled-plugins')).toBe(true)
    expect(resolver?.steps?.some(step => step.with?.name === 'bundled-plugin-snapshot')).toBe(true)

    for (const name of ['macos', 'windows', 'linux']) {
      const job = workflow.jobs[name]
      expect(Array.isArray(job?.needs) ? job.needs : [job?.needs]).toContain('bundled-plugins')
      expect(job?.env?.DSH_BUNDLED_PLUGINS_REFRESH).toBe('0')
      expect(job?.steps?.some(step => (
        step.uses === 'actions/download-artifact@v4'
        && step.with?.name === 'bundled-plugin-snapshot'
        && step.with?.path === 'apps/desktop/bundled-plugins'
      ))).toBe(true)
    }
  })

  it('can reuse one verified bundled-plugin snapshot across platform runs', () => {
    const { workflow } = readWorkflow()
    expect(workflow.on.workflow_dispatch.inputs).toHaveProperty('bundled_plugin_run_id')
    const resolver = workflow.jobs['bundled-plugins']
    expect(resolver?.if).toBeUndefined()
    expect(resolver?.steps?.some(step => (
      step.name === 'Verify reused bundled plugin snapshot commit'
      && step.if?.includes("inputs.bundled_plugin_run_id != ''")
      && step.run?.includes('head_sha')
    ))).toBe(true)
    expect(resolver?.steps?.some(step => (
      step.uses === 'actions/download-artifact@v4'
      && step.if?.includes("inputs.bundled_plugin_run_id != ''")
      && step.with?.name === 'bundled-plugin-snapshot'
      && step.with?.['run-id'] === '${{ inputs.bundled_plugin_run_id }}'
    ))).toBe(true)
  })

  it('exposes a stable orchestration key in the workflow run title', () => {
    const { workflow } = readWorkflow()
    expect(workflow.on.workflow_dispatch.inputs).toHaveProperty('orchestration_id')
    expect(workflow['run-name']).toContain('inputs.orchestration_id')
  })

  it('builds only the native bundled Python runtime and does not publish separate runtime artifacts', () => {
    const { workflow } = readWorkflow()
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        expect(step.run ?? '').not.toContain('assemble-workspace-runtime-manifest.ts')
        expect(step.with?.name ?? '').not.toMatch(/^workspace-runtime-/u)
        expect(step.with?.pattern ?? '').not.toMatch(/^workspace-runtime-/u)
      }
    }
    expect(workflow.jobs.windows?.steps?.some(step => step.run?.includes('prepare-workspace-runtime.ts win-x64'))).toBe(true)
    expect(workflow.jobs.checksums?.steps?.some(step => step.uses === 'pnpm/action-setup@v4')).toBe(false)
    expect(workflow.jobs.checksums?.steps?.some(step => step.uses === 'actions/setup-node@v6')).toBe(false)
  })

  it('disables redundant compression for already compressed release payloads', () => {
    const { workflow } = readWorkflow()
    const releaseArtifactNames = new Set([
      'desktop-macos-${{ matrix.arch }}',
      'desktop-windows-x64',
      'desktop-linux-x64',
    ])
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses !== 'actions/upload-artifact@v4' || !releaseArtifactNames.has(step.with?.name ?? '')) continue
        expect(step.with?.['compression-level'], step.with?.name).toBe('0')
      }
    }
  })

  it('writes canonical installer names into the checksum artifact', () => {
    const { workflow } = readWorkflow()
    const writeChecksums = workflow.jobs.checksums?.steps?.find(step => step.name === 'Write checksums')
    expect(writeChecksums?.run).toContain("sed 's#  \\./#  #'")
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

  it('allows different platform targets on the same branch to run in parallel', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../../.github/workflows/desktop-packages.yml'), 'utf8')
    const workflow = parse(source) as { concurrency: { group: string; 'cancel-in-progress': boolean } }
    expect(workflow.concurrency.group).toContain('${{ inputs.target }}')
    expect(workflow.concurrency['cancel-in-progress']).toBe(false)
  })

  it('raises the macOS packaging file limit before electron-builder signs the expanded runtime', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../../.github/workflows/desktop-packages.yml'), 'utf8')
    const workflow = parse(source) as { jobs: Record<string, WorkflowJob> }
    const prepare = workflow.jobs.macos?.steps?.find(step => step.name === 'Prepare macOS Harness runtime and preset Profile')
    const build = workflow.jobs.macos?.steps?.find(step => step.name === 'Build macOS DMG and ZIP')
    expect(prepare?.run).toContain('ulimit -n 65536')
    expect(build?.run).toContain('ulimit -n 65536')
    expect(build?.run).toContain('electron-builder/out/cli/cli.js')
  })

  it('keeps packaging manual and leaves GitHub Release publication to the explicit local workflow', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../../.github/workflows/desktop-packages.yml'), 'utf8')
    const workflow = parse(source) as {
      on: { workflow_dispatch: { inputs: Record<string, unknown> } }
      permissions: Record<string, string>
      jobs: Record<string, WorkflowJob>
    }
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual([
      'target', 'refresh_plugins', 'bundled_plugin_run_id', 'orchestration_id', 'windows_candidate_run_id',
    ])
    expect(workflow.on.workflow_dispatch.inputs.refresh_plugins).toEqual({
      description: 'Resolve latest stable bundled plugins (disable for a packaging-only rebuild)',
      required: true,
      type: 'boolean',
      default: true,
    })
    expect(workflow.permissions).toEqual({ contents: 'read', actions: 'read' })
    expect(workflow.jobs.release).toBeUndefined()
    expect(source).not.toContain('gh release ')
  })

  it('separates reusable Windows candidates from the full installed smoke', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../../.github/workflows/desktop-packages.yml'), 'utf8')
    const workflow = parse(source) as { jobs: Record<string, WorkflowJob> }
    const build = workflow.jobs.windows
    const preflight = workflow.jobs['windows-preflight']
    const smoke = workflow.jobs['windows-smoke']

    expect(build?.needs).toEqual(['bundled-plugins', 'windows-preflight'])
    expect(preflight?.if).toContain("inputs.target == 'windows-x64'")
    expect(preflight?.steps?.some(step => (
      step.name === 'Verify Windows packaging and candidate contracts'
      && step.run?.includes('windows-package-candidate.test.mjs')
      && step.run?.includes('runtime-deploy-config.test.mjs')
    ))).toBe(true)
    expect(preflight?.steps?.find(step => step.name === 'Verify Windows runner protocol')?.run)
      .toContain('packages/subprocess/subprocess-local/tests/spawn-runner.spec.ts')
    expect(build?.steps?.some(step => step.name === 'Verify Windows runner protocol')).toBe(false)
    expect(build?.steps?.some(step => step.run === 'pnpm run build:community-desktop')).toBe(true)
    expect(build?.steps?.some(step => step.run === 'node apps/desktop/scripts/prepare-windows-runtime.mjs')).toBe(true)
    expect(build?.steps?.some(step => step.run === 'node apps/desktop/scripts/smoke-windows-unpacked.mjs')).toBe(true)
    expect(build?.steps?.some(step => (
      step.name === 'Record Windows candidate identity'
      && step.run?.includes('windows-package-candidate.mjs create')
    ))).toBe(true)
    expect(build?.steps?.some(step => (
      step.name === 'Preserve Windows candidate'
      && step.if === '${{ always() }}'
      && step.with?.name === 'qualification-windows-x64-candidate'
      && step.with?.path?.includes('DeepSeek-Harness-windows-x64.exe')
      && step.with?.path?.includes('windows-package-candidate.json')
      && !step.with?.path?.includes('win-unpacked')
      && step.with?.['if-no-files-found'] === 'warn'
    ))).toBe(true)

    expect(smoke?.if).toContain('inputs.windows_candidate_run_id')
    expect(smoke?.steps?.some(step => step.uses === 'pnpm/action-setup@v4')).toBe(false)
    expect(smoke?.steps?.some(step => step.run === 'pnpm install --frozen-lockfile')).toBe(false)
    expect(smoke?.steps?.some(step => step.uses === 'actions/setup-node@v6' && step.with?.cache === undefined)).toBe(true)
    const evidenceCheck = smoke?.steps?.find(step => step.name === 'Verify Windows smoke evidence interface')
    expect(evidenceCheck?.run).toContain('windows-smoke-journal.test.ps1')
    expect(evidenceCheck?.run).toContain('node --test apps/desktop/scripts/collect-windows-smoke-evidence.test.mjs')
    expect(smoke?.steps?.some(step => (
      step.uses === 'actions/download-artifact@v4'
      && step.with?.name === 'bundled-plugin-snapshot'
      && step.with?.path === '.artifacts/bundled-plugin-snapshot'
    ))).toBe(true)
    expect(smoke?.steps?.some(step => (
      step.name === 'Verify Windows candidate identity'
      && step.run?.includes('windows-package-candidate.mjs verify')
    ))).toBe(true)
    expect(smoke?.steps?.some(step => step.name === 'Verify reused candidate commit')).toBe(false)
    expect(smoke?.steps?.some(step => step.with?.['run-id'] === '${{ inputs.windows_candidate_run_id || github.run_id }}')).toBe(true)
    const installedSmoke = smoke?.steps?.find(step => step.name === 'Smoke test installed Windows package')
    expect(installedSmoke?.run).toBe('apps/desktop/scripts/smoke-windows-package.ps1')
    expect(smoke?.steps?.some(step => (
      step.name === 'Collect Windows smoke evidence'
      && step.run === 'node apps/desktop/scripts/collect-windows-smoke-evidence.mjs'
      && step['continue-on-error'] === true
    ))).toBe(true)
    expect(smoke?.steps?.some(step => (
      step.name === 'Preserve Windows smoke evidence'
      && step.with?.name === 'qualification-windows-x64-evidence'
      && step.with?.path === '.artifacts/windows-smoke-evidence'
      && step.if === '${{ always() }}'
    ))).toBe(true)
    expect(smoke?.steps?.some(step => step.with?.name === 'desktop-windows-x64')).toBe(true)
  })
})
