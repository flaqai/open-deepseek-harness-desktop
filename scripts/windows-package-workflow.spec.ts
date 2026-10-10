/** Manual Windows packaging and qualification use the community native workflow. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'js-yaml'
import { expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const workflow = yaml.load(readFileSync(resolve(root, '.github/workflows/desktop-packages.yml'), 'utf8')) as {
  on: Record<string, { inputs: Record<string, { required?: boolean; options?: string[] }> }>
  permissions: Record<string, string>
  concurrency: { group: string; 'cancel-in-progress': boolean }
  jobs: Record<string, {
    'runs-on': string
    needs?: string[]
    defaults?: { run: { shell: string } }
    steps: Array<{
      name?: string
      uses?: string
      run?: string
      if?: string
      with?: Record<string, unknown>
    }>
  }>
}
const build = workflow.jobs.windows!
const smoke = workflow.jobs['windows-smoke']!

it('requires explicit manual target selection and native Windows runners', () => {
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
  expect(workflow.on.workflow_dispatch!.inputs.target!.required).toBe(true)
  expect(workflow.on.workflow_dispatch!.inputs.target!.options).toContain('windows-x64')
  expect(workflow.concurrency['cancel-in-progress']).toBe(false)
  expect(workflow.permissions.contents).toBe('read')
  for (const job of [build, smoke]) {
    expect(job['runs-on']).toMatch(/^windows-/u)
    expect(job.steps.find(step => step.uses?.startsWith('actions/checkout@'))?.with)
      .toMatchObject({ 'persist-credentials': false })
  }
})

it('builds from the community runtime and qualifies the installed candidate before final upload', () => {
  const prepare = build.steps.findIndex(step => step.run === 'node apps/desktop/scripts/prepare-windows-runtime.mjs')
  const packageIndex = build.steps.findIndex(step => step.name === 'Build Windows installer')
  expect(prepare).toBeGreaterThanOrEqual(0)
  expect(packageIndex).toBeGreaterThan(prepare)
  expect(build.steps[packageIndex]!.run).toContain('--win nsis --x64 --publish never')
  expect(smoke.needs).toEqual(expect.arrayContaining(['windows', 'windows-preflight']))
  const qualification = smoke.steps.findIndex(step => step.run === 'node apps/desktop/scripts/desktop-smoke.mjs package windows-x64')
  const upload = smoke.steps.findIndex(step => step.name === 'Publish qualified Windows artifact')
  expect(qualification).toBeGreaterThanOrEqual(0)
  expect(upload).toBeGreaterThan(qualification)
  expect(smoke.steps[upload]!.if).toBeUndefined()
  expect(smoke.steps[upload]!.with?.path).toContain('.artifacts/desktop-windows/DeepSeek-Harness-windows-x64.exe')
  expect(smoke.steps[upload]!.with?.['if-no-files-found']).toBe('error')
})

it('retains candidate and smoke evidence even when qualification fails', () => {
  for (const [job, name, path] of [
    [build, 'Preserve Windows candidate', '.artifacts/desktop-windows/windows-package-candidate.json'],
    [smoke, 'Preserve Windows smoke evidence', '.artifacts/windows-smoke-evidence'],
  ] as const) {
    const step = job.steps.find(value => value.name === name)!
    expect(step.if).toContain('always()')
    expect(step.uses).toMatch(/^actions\/upload-artifact@/u)
    expect(step.with?.path).toContain(path)
    expect(step.with?.['if-no-files-found']).toBe('warn')
  }
})
