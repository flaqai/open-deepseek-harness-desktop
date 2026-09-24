import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { collectWindowsSmokeEvidence } from './collect-windows-smoke-evidence.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-windows-smoke-evidence-'))
  const runnerTemp = join(root, 'Runner Temp 中文')
  const destination = join(root, 'artifact')
  await mkdir(join(runnerTemp, 'DeepSeek Harness AppData', 'open-deepseek-harness-desktop', 'logs'), { recursive: true })
  await mkdir(join(runnerTemp, 'DeepSeek Harness Home', 'profiles', 'web'), { recursive: true })
  await writeFile(join(runnerTemp, 'DeepSeek Harness AppData', 'desktop-entry.log'), 'secret-entry-content')
  await writeFile(join(runnerTemp, 'DeepSeek Harness AppData', 'open-deepseek-harness-desktop', 'logs', 'harness.log'), 'token=secret-token')
  await writeFile(join(runnerTemp, 'DeepSeek Harness Home', 'profiles', 'web', 'package.json'), '{"private":"secret-value"}')
  const phaseNames = [
    'package-contract', 'install', 'native-entry', 'first-start', 'process-guard',
    'upgrade', 'restart', 'cli', 'plugins', 'uninstall',
  ]
  await writeFile(join(runnerTemp, 'DeepSeek-Harness-smoke-status.json'), JSON.stringify({
    schema: 'open-dsh/windows-package-smoke/v1',
    status: 'passed',
    startedAt: '2026-09-19T00:00:00.000Z',
    completedAt: '2026-09-19T00:00:01.000Z',
    currentPhase: 'uninstall',
    phases: phaseNames.map(name => ({
      name, outcome: 'passed', startedAt: '2026-09-19T00:00:00.000Z',
      completedAt: '2026-09-19T00:00:01.000Z', durationMs: 1000, unsafeDetail: 'journal-secret',
    })),
    unsafeDetail: 'journal-secret',
  }))
  return { root, runnerTemp, destination }
}

test('collects stable metadata without file contents or source paths', async () => {
  const { runnerTemp, destination } = await fixture()
  const now = () => new Date('2026-09-19T00:00:00.000Z')
  const first = await collectWindowsSmokeEvidence({
    runnerTemp, destination, platform: 'linux', runId: '42', runAttempt: '3', now,
  })
  const second = await collectWindowsSmokeEvidence({
    runnerTemp, destination, platform: 'linux', runId: '42', runAttempt: '3', now,
  })
  assert.deepEqual(second, first)
  assert.equal(first.schema, 'open-dsh/windows-smoke-evidence/v1')
  assert.equal(first.status, 'complete')
  assert.equal(first.files.find(entry => entry.label === 'desktop-entry')?.status, 'present')
  assert.equal(first.files.find(entry => entry.label === 'profile-lock')?.status, 'missing')
  assert.equal(first.smoke.status, 'collected')
  assert.equal(first.smoke.journal.status, 'passed')
  const persisted = await readFile(join(destination, 'evidence.json'), 'utf8')
  assert.deepEqual(JSON.parse(persisted), first)
  for (const secret of ['secret-entry-content', 'secret-token', 'secret-value', 'journal-secret', runnerTemp]) {
    assert.equal(persisted.includes(secret), false, secret)
  }
  assert.deepEqual(first.processes, { status: 'unsupported', entries: [] })
})

test('records path probe failures as degraded evidence', async () => {
  const { destination } = await fixture()
  const evidence = await collectWindowsSmokeEvidence({
    runnerTemp: join(tmpdir(), 'invalid\0path'), destination, platform: 'linux',
  })
  assert.equal(evidence.status, 'degraded')
  assert.ok(evidence.files.every(entry => entry.status === 'unavailable'))
  assert.ok(evidence.files.every(entry => entry.errorKind === 'io-error'))
  assert.doesNotMatch(JSON.stringify(evidence), /ENAMETOOLONG|no such file|permission denied/iu)
})

test('rejects an invalid smoke journal without retaining its contents', async () => {
  const { runnerTemp, destination } = await fixture()
  await writeFile(join(runnerTemp, 'DeepSeek-Harness-smoke-status.json'), JSON.stringify({
    schema: 'open-dsh/windows-package-smoke/v1', status: 'failed', secret: 'unsafe-journal-value', phases: [],
  }))
  const evidence = await collectWindowsSmokeEvidence({ runnerTemp, destination, platform: 'linux' })
  assert.deepEqual(evidence.smoke, { status: 'degraded', errorKind: 'journal-invalid' })
  assert.equal(JSON.stringify(evidence).includes('unsafe-journal-value'), false)
})

test('accepts a failed phase prefix and preserves only its safe category', async () => {
  const { runnerTemp, destination } = await fixture()
  await writeFile(join(runnerTemp, 'DeepSeek-Harness-smoke-status.json'), JSON.stringify({
    schema: 'open-dsh/windows-package-smoke/v1',
    status: 'failed',
    startedAt: '2026-09-19T00:00:00.000Z',
    completedAt: '2026-09-19T00:00:01.000Z',
    currentPhase: 'install',
    phases: [
      { name: 'package-contract', outcome: 'passed', startedAt: '2026-09-19T00:00:00.000Z', completedAt: '2026-09-19T00:00:00.500Z', durationMs: 500 },
      { name: 'install', outcome: 'failed', startedAt: '2026-09-19T00:00:00.500Z', completedAt: '2026-09-19T00:00:01.000Z', durationMs: 500, errorKind: 'install-failed', unsafeDetail: 'secret-stack' },
    ],
  }))
  const evidence = await collectWindowsSmokeEvidence({ runnerTemp, destination, platform: 'linux' })
  assert.equal(evidence.smoke.status, 'collected')
  assert.equal(evidence.smoke.journal.phases.at(-1).errorKind, 'install-failed')
  assert.equal(JSON.stringify(evidence).includes('secret-stack'), false)
})

test('degrades quickly and safely when the Windows process query is unavailable', async () => {
  const { root, runnerTemp, destination } = await fixture()
  const missingSystemRoot = join(root, 'private-missing-system-root')
  const startedAt = performance.now()
  const evidence = await collectWindowsSmokeEvidence({
    runnerTemp, destination, platform: 'win32', environment: { SystemRoot: missingSystemRoot },
  })
  assert.ok(performance.now() - startedAt < 5_000, 'a missing PowerShell must fail without waiting for the query timeout')
  assert.deepEqual(evidence.processes, {
    status: 'degraded', errorKind: 'process-query-failed', entries: [],
  })
  assert.equal(evidence.status, 'degraded')
  assert.equal(evidence.smoke.status, 'collected')
  const persisted = await readFile(join(destination, 'evidence.json'), 'utf8')
  assert.deepEqual(JSON.parse(persisted), evidence)
  assert.equal(persisted.includes(missingSystemRoot), false)
  assert.equal(persisted.includes('private-missing-system-root'), false)
  assert.equal(persisted.includes(runnerTemp), false)
})

test('collects native Windows process metadata through the real interface', { skip: process.platform !== 'win32' }, async () => {
  const { runnerTemp, destination } = await fixture()
  const evidence = await collectWindowsSmokeEvidence({ runnerTemp, destination })
  if (evidence.processes.status === 'collected') {
    assert.deepEqual(Object.keys(evidence.processes).sort(), ['entries', 'status'])
    assert.equal(evidence.status, 'complete')
    for (const entry of evidence.processes.entries) {
      assert.deepEqual(Object.keys(entry).sort(), ['name', 'parentProcessId', 'processId'])
      assert.ok(Number.isSafeInteger(entry.processId) && entry.processId >= 0)
      assert.ok(Number.isSafeInteger(entry.parentProcessId) && entry.parentProcessId >= 0)
      assert.ok(typeof entry.name === 'string' && entry.name.length > 0 && entry.name.length <= 128)
    }
  } else {
    assert.deepEqual(evidence.processes, {
      status: 'degraded', errorKind: 'process-query-failed', entries: [],
    })
    assert.equal(evidence.status, 'degraded')
  }
  const persisted = await readFile(join(destination, 'evidence.json'), 'utf8')
  assert.deepEqual(JSON.parse(persisted), evidence)
  assert.equal(persisted.includes(runnerTemp), false)
})

test('fails only when the evidence destination cannot be created', async () => {
  const { root, runnerTemp } = await fixture()
  const destination = join(root, 'not-a-directory')
  await writeFile(destination, 'occupied')
  await assert.rejects(
    collectWindowsSmokeEvidence({ runnerTemp, destination, platform: 'linux' }),
    /EEXIST|not a directory/iu,
  )
})
