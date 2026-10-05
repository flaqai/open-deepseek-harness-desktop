import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { createSmokePlan, executeSmoke, parseSmokeArguments } from './desktop-smoke.mjs'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const entry = join(import.meta.dirname, 'desktop-smoke.mjs')
const pass = { code: 0, signal: null, timedOut: false }

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-smoke-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('accepts only the fixed stages, targets, and trailing preview flag', () => {
  assert.deepEqual(parseSmokeArguments(['contracts', 'windows-x64', '--plan']), { stage: 'contracts', target: 'windows-x64', plan: true })
  for (const args of [[], ['package'], ['package', 'win32'], ['other', 'windows-x64'], ['package', '__proto__'],
    ['unpacked', 'linux-x64'], ['unpacked', 'macos-arm64'], ['package', 'windows-x64', '--installer=arbitrary'],
    ['package', 'windows-x64', '--plan', 'extra'], ['--plan', 'package', 'windows-x64']]) {
    assert.throws(() => parseSmokeArguments(args))
  }
})

test('contracts preserve each platform check and add both shared runner checks', () => {
  const basenames = target => createSmokePlan({ stage: 'contracts', target }).steps[0].args.map(arg => arg.replaceAll('\\', '/').split('/').at(-1))
  assert.deepEqual(basenames('windows-x64'), ['--test', 'runtime-deploy-config.test.mjs', 'collect-windows-smoke-evidence.test.mjs',
    'windows-package-candidate.test.mjs', 'electron-package-probe.test.mjs', 'desktop-smoke.test.mjs'])
  assert.deepEqual(basenames('macos-arm64'), ['--test', 'smoke-macos-package.test.mjs', 'electron-package-probe.test.mjs', 'desktop-smoke.test.mjs'])
  assert.deepEqual(basenames('linux-x64'), ['--test', 'runtime-file-policy.test.mjs', 'workspace-runtime-packaging.test.mjs',
    'packaged-resource-contract.test.mjs', 'electron-package-probe.test.mjs', 'desktop-smoke.test.mjs'])
  const journal = createSmokePlan({ stage: 'contracts', target: 'windows-x64' }).steps[1]
  assert.equal(journal.command, 'pwsh')
  assert.equal(journal.args.at(-1), join(import.meta.dirname, 'windows-smoke-journal.test.ps1'))
})

test('package and unpacked plans retain exact artifact paths and acceptance scopes', () => {
  const windows = createSmokePlan({ stage: 'package', target: 'windows-x64' })
  assert.deepEqual(windows.steps.map(step => step.id), ['windows-candidate', 'windows-installed', 'windows-evidence'])
  assert.deepEqual(windows.steps[0].args.slice(1), ['verify', repositoryRoot,
    join(repositoryRoot, '.artifacts/desktop-windows/DeepSeek-Harness-windows-x64.exe'),
    join(repositoryRoot, '.artifacts/bundled-plugin-snapshot'), join(repositoryRoot, '.artifacts/desktop-windows/windows-package-candidate.json')])
  assert.equal(windows.steps[2].always, true)
  assert.equal(createSmokePlan({ stage: 'unpacked', target: 'windows-x64' }).scope, 'native-unpacked')
  for (const arch of ['arm64', 'x64']) {
    const mac = createSmokePlan({ stage: 'package', target: `macos-${arch}` })
    assert.deepEqual(mac.steps[0].args.slice(1), ['dmg', 'zip'].map(extension =>
      join(repositoryRoot, '.artifacts/desktop-macos', `DeepSeek-Harness-macos-${arch}.${extension}`)))
  }
  const linux = createSmokePlan({ stage: 'package', target: 'linux-x64' })
  assert.equal(linux.scope, 'resources-only')
  assert.deepEqual(linux.steps[0].args, [join(import.meta.dirname, 'verify-prebuilt-profile.mjs'),
    join(repositoryRoot, '.artifacts/desktop-linux/linux-unpacked/resources')])
  assert.ok(windows.steps.every(step => step.timeoutMs > 0))
})

test('real CLI preview is independent of cwd and never requires the target host or artifacts', async t => {
  const directory = await fixture(t)
  const result = spawnSync(process.execPath, [entry, 'package', 'windows-x64', '--plan'], {
    cwd: directory, encoding: 'utf8', timeout: 10_000, env: { ...process.env, PRIVATE_SMOKE_TOKEN: 'must-not-appear' },
  })
  assert.equal(result.status, 0, result.stderr)
  const plan = JSON.parse(result.stdout)
  assert.equal(plan.steps[0].args[2], repositoryRoot)
  assert.equal(plan.scope, 'native-package')
  assert.ok(!result.stdout.includes('must-not-appear'))
  assert.deepEqual(await readdir(directory), [])
})

test('execution rejects a wrong native host or architecture before any command or temp creation', async t => {
  const directory = await fixture(t)
  for (const host of [{ platform: 'linux', arch: 'x64' }, { platform: 'win32', arch: 'arm64' }]) {
    await assert.rejects(executeSmoke({ stage: 'package', target: 'windows-x64' }, {
      ...host, environment: { RUNNER_TEMP: directory }, run: () => { assert.fail('must not execute') },
    }), /matching native host/u)
  }
  await assert.rejects(executeSmoke({ stage: 'package', target: 'windows-x64' }, {
    platform: 'win32', arch: 'x64', environment: { RUNNER_TEMP: 'relative' },
  }), /absolute RUNNER_TEMP/u)
  assert.deepEqual(await readdir(directory), [])
})

async function windowsRun(t, outcomes, writeSummary = async () => {}) {
  const directory = await fixture(t)
  const calls = []
  const result = await executeSmoke({ stage: 'package', target: 'windows-x64' }, {
    platform: 'win32', arch: 'x64', repositoryRoot: directory,
    environment: { RUNNER_TEMP: directory, PRIVATE_SMOKE_TOKEN: 'private-value' }, writeSummary,
    run: async (step, options) => {
      calls.push({ id: step.id, ...options })
      const outcome = outcomes[step.id] ?? pass
      if (outcome instanceof Error) throw outcome
      return outcome
    },
  })
  return { directory, calls, result }
}

test('candidate validation precedes installed smoke and all steps share one owned retained temp directory', async t => {
  const { directory, calls, result } = await windowsRun(t, {})
  assert.deepEqual(calls.map(call => call.id), ['windows-candidate', 'windows-installed', 'windows-evidence'])
  assert.equal(result.exitCode, 0)
  const temp = calls[0].env.RUNNER_TEMP
  assert.notEqual(temp, directory)
  assert.equal(resolve(temp, '..'), directory)
  assert.ok((await stat(temp)).isDirectory())
  assert.ok(calls.every(call => call.cwd === directory && call.env.RUNNER_TEMP === temp && call.env.TEMP === temp && call.env.TMP === temp))
})

test('a rejected candidate prevents install but still collects bounded evidence', async t => {
  const { calls, result } = await windowsRun(t, { 'windows-candidate': { ...pass, code: 9 } })
  assert.deepEqual(calls.map(call => call.id), ['windows-candidate', 'windows-evidence'])
  assert.equal(result.exitCode, 9)
})

test('failed installed smoke still collects evidence and collector failure does not replace the primary result', async t => {
  const { calls, result } = await windowsRun(t, {
    'windows-installed': { ...pass, code: 7 }, 'windows-evidence': { ...pass, code: 3 },
  })
  assert.deepEqual(calls.map(call => call.id), ['windows-candidate', 'windows-installed', 'windows-evidence'])
  assert.equal(result.exitCode, 7)
  assert.equal(result.records.at(-1).outcome, 'failed')
})

test('collector or summary-write failures leave a passed qualification passed', async t => {
  const { result } = await windowsRun(t, { 'windows-evidence': new Error('sensitive diagnostic output') }, async () => {
    throw new Error('sensitive destination')
  })
  assert.equal(result.exitCode, 0)
  assert.equal(result.summaryWritten, false)
  assert.equal(result.records.at(-1).outcome, 'failed')
})

test('a timeout or thrown runner error fails qualification while retaining evidence collection', async t => {
  for (const failure of [{ code: null, signal: 'SIGKILL', timedOut: true }, new Error('sensitive spawn error')]) {
    const { result, calls } = await windowsRun(t, { 'windows-installed': failure })
    assert.equal(result.exitCode, 1)
    assert.equal(calls.at(-1).id, 'windows-evidence')
  }
})

test('summary records only closed status fields and never stores environment, output, command or path', async t => {
  let summary
  const { result, directory } = await windowsRun(t, {
    'windows-installed': { ...pass, stdout: 'private-value', stderr: 'private-value', env: { PRIVATE_SMOKE_TOKEN: 'private-value' } },
  }, async (path, records) => { summary = { path, records } })
  assert.equal(summary.path, join(directory, '.artifacts/desktop-smoke/package-windows-x64.json'))
  assert.deepEqual(summary.records, result.records)
  const fields = ['stepId', 'outcome', 'durationMs', 'code', 'signal', 'timedOut', 'target', 'stage']
  assert.ok(summary.records.every(record => JSON.stringify(Object.keys(record)) === JSON.stringify(fields)))
  assert.ok(!JSON.stringify(summary.records).includes('private-value'))
  assert.ok(!JSON.stringify(summary.records).includes(directory))
})

test('contracts execution stops after the first failed contract group', async () => {
  const calls = []
  const result = await executeSmoke({ stage: 'contracts', target: 'windows-x64' }, {
    platform: 'win32', arch: 'x64', writeSummary: async () => {},
    run: step => { calls.push(step.id); return { ...pass, code: 2 } },
  })
  assert.equal(result.exitCode, 2)
  assert.deepEqual(calls, ['node-contracts'])
})
