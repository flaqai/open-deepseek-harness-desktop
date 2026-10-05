import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

const root = resolve(import.meta.dirname, '../../..')

test('local package commands verify a fixed plugin snapshot without refreshing it', async () => {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  assert.match(pkg.scripts['verify:desktop:bundled-plugin-snapshot'], /--verify-only/u)
  for (const target of ['win:x64', 'macos:arm64', 'macos:x64', 'linux:x64']) {
    const command = pkg.scripts[`package:desktop:${target}`]
    assert.match(command, /pnpm run verify:desktop:bundled-plugin-snapshot/u)
    assert.doesNotMatch(command, /prepare:desktop:bundled-plugins|refresh:desktop:bundled-plugins/u)
  }
})

test('native workflow isolates package phases, uses one registry, and reports only qualified sizes', async () => {
  const workflow = parse(await readFile(resolve(root, '.github/workflows/desktop-packages.yml'), 'utf8'))
  assert.equal(workflow.env.PNPM_CONFIG_REGISTRY, 'https://registry.npmjs.org')
  assert.match(workflow.env.NO_PROXY, /127\.0\.0\.1/u)
  for (const jobName of ['macos', 'windows', 'linux']) {
    const steps = workflow.jobs[jobName].steps
    const names = steps.map(step => step.name)
    const verification = names.findIndex(name => /Verify resolved bundled plugin snapshot|Prepare bundled plugins/u.test(name))
    const build = names.findIndex(name => /Build macOS Host|Build clean-checkout Host|Build Linux Host/u.test(name))
    assert.ok(verification >= 0 && verification < build, `${jobName}: snapshot verification precedes build`)
    if (jobName !== 'windows') {
      const size = names.findIndex(name => /Record qualified .*installer size/u.test(name))
      const upload = steps.findIndex(step => step.uses?.startsWith('actions/upload-artifact@'))
      assert.ok(size > build && size < upload, `${jobName}: size follows qualification and precedes upload`)
      const finalCheck = names.findIndex(name => jobName === 'macos'
        ? name === 'Smoke final macOS DMG and ZIP'
        : name === 'Verify packaged preset resources')
      assert.ok(finalCheck > build && finalCheck < size, `${jobName}: final package check precedes size report`)
    }
  }
  const windowsSmokeNames = workflow.jobs['windows-smoke'].steps.map(step => step.name)
  assert.ok(windowsSmokeNames.indexOf('Smoke test installed Windows package')
    < windowsSmokeNames.indexOf('Record qualified Windows installer size'))
  assert.ok(windowsSmokeNames.indexOf('Record qualified Windows installer size')
    < windowsSmokeNames.indexOf('Publish qualified Windows artifact'))
  const mac = workflow.jobs.macos.steps.map(step => step.name)
  assert.ok(mac.indexOf('Prepare macOS Harness runtime and preset Profile') < mac.indexOf('Build macOS DMG and ZIP'))
  const linux = workflow.jobs.linux.steps.map(step => step.name)
  assert.ok(linux.indexOf('Prepare Linux Harness runtime and preset Profile') < linux.indexOf('Build Linux installers'))
})

test('Windows candidate reuse reruns fast preflight and strict installed smoke without rebuilding', async () => {
  const workflow = parse(await readFile(resolve(root, '.github/workflows/desktop-packages.yml'), 'utf8'))
  const preflight = workflow.jobs['windows-preflight']
  assert.doesNotMatch(preflight.if, /windows_candidate_run_id == ''/u)
  assert.ok(preflight.steps.some(step => step.name === 'Verify first-start candidate lifecycle'))
  assert.match(workflow.jobs.windows.if, /windows_candidate_run_id == ''/u)
  const smoke = workflow.jobs['windows-smoke']
  assert.ok(smoke.needs.includes('windows-preflight'))
  assert.match(smoke.if, /needs\.windows-preflight\.result == 'success'/u)
  assert.equal(smoke.steps.find(step => step.uses === 'actions/checkout@v6')?.with?.['fetch-depth'], "${{ inputs.windows_candidate_run_id != '' && '0' || '1' }}")
  assert.equal(smoke.steps.find(step => step.name === 'Smoke test installed Windows package')?.run,
    'node apps/desktop/scripts/desktop-smoke.mjs package windows-x64')
})

test('workflow routes native smoke stages through one runner without repeating evidence tests', async () => {
  const workflow = parse(await readFile(resolve(root, '.github/workflows/desktop-packages.yml'), 'utf8'))
  const step = (job, name) => workflow.jobs[job].steps.find(item => item.name === name)
  assert.equal(step('windows-preflight', 'Verify Windows packaging and candidate contracts')?.run,
    'node apps/desktop/scripts/desktop-smoke.mjs contracts windows-x64')
  assert.equal(step('windows', 'Probe unpacked app.asar and Electron entries')?.run,
    'node apps/desktop/scripts/desktop-smoke.mjs unpacked windows-x64')
  assert.equal(step('macos', 'Smoke final macOS DMG and ZIP')?.run,
    'node apps/desktop/scripts/desktop-smoke.mjs package macos-${{ matrix.arch }}')
  assert.equal(step('linux', 'Verify packaged preset resources')?.run,
    'node apps/desktop/scripts/desktop-smoke.mjs package linux-x64')
  assert.ok(!workflow.jobs['windows-smoke'].steps.some(item => item.name === 'Verify Windows smoke evidence interface'))
  assert.ok(!workflow.jobs['windows-smoke'].steps.some(item => item.name === 'Collect Windows smoke evidence'))
  const evidence = step('windows-smoke', 'Preserve Windows smoke evidence')
  assert.equal(evidence.if, '${{ always() }}')
  assert.equal(evidence.with.path, '.artifacts/windows-smoke-evidence')
})
