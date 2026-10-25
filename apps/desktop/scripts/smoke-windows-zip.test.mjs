import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { qualifyWindowsZip, windowsZipSteps } from './smoke-windows-zip.mjs'

test('extracts the final archive without interpolating paths and probes the extracted resources', () => {
  const destination = resolve('中文 with spaces $test')
  const archive = resolve('with spaces $test.zip')
  const steps = windowsZipSteps(archive, destination)
  assert.equal(steps.length, 3)
  assert.equal(steps[0].env.DSH_ZIP_ARCHIVE, archive)
  assert.equal(steps[0].env.DSH_ZIP_DESTINATION, destination)
  assert.ok(!steps[0].args.join(' ').includes(archive))
  assert.match(steps[1].args[0], /verify-prebuilt-profile\.mjs$/u)
  assert.equal(steps[1].args[1], resolve(destination, 'resources'))
  assert.match(steps[2].args[0], /smoke-windows-unpacked\.mjs$/u)
  assert.equal(steps[2].args[1], destination)
})

test('blocks acceptance on extraction failure, omitted support resources and native probe failure', async () => {
  const destination = await mkdtemp(resolve(tmpdir(), 'windows-zip-behavior-'))
  try {
    const calls = []
    const run = (command, args) => { calls.push({ command, args }); return { status: 0, signal: null } }
    await assert.rejects(qualifyWindowsZip('fixture.zip', destination, () => ({ status: 2, signal: null })), /qualification failed/u)
    await assert.rejects(qualifyWindowsZip('fixture.zip', destination, run), /ENOENT/u)
    assert.equal(calls.length, 1, 'missing support tools stop before Profile and Electron probes')
    const support = resolve(destination, 'resources/support/windows-install-repair')
    await mkdir(support, { recursive: true })
    for (const name of ['START-REPAIR.cmd', 'START-ALL-USERS-REPAIR.cmd', 'README.md', 'README.zh.md']) await writeFile(resolve(support, name), 'fixture')
    calls.length = 0
    await assert.rejects(qualifyWindowsZip('fixture.zip', destination, (command, args) => {
      const result = run(command, args)
      return args[0].endsWith('verify-prebuilt-profile.mjs') ? { status: 1, signal: null } : result
    }), /qualification failed/u)
    assert.equal(calls.length, 2, 'invalid Profile stops before Electron launch')
    calls.length = 0
    await qualifyWindowsZip('fixture.zip', destination, run)
    assert.equal(calls.length, 3)
  } finally {
    await rm(destination, { recursive: true, force: true })
  }
})
