import assert from 'node:assert/strict'
import { access, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { runElectronPackageProbe } from './electron-package-probe.mjs'

const marker = 'DSH_PROBE_READY'
const run = (program, timeoutMs = 3000) => runElectronPackageProbe({
  executable: process.execPath, args: ['-e', program, '--'], marker, timeoutMs,
})
const removed = root => assert.rejects(access(root), { code: 'ENOENT' })
async function rejectsProbe(promise, validate) {
  let rejection
  await assert.rejects(promise, error => { rejection = error; return true })
  await validate(rejection)
}

test('uses and removes an isolated root, preserving bounded entry diagnostics', async () => {
  const result = await run(`
    const fs = require('node:fs'); const path = require('node:path');
    const root = process.argv.find(arg => arg.startsWith('--dsh-package-smoke-root=')).split('=').slice(1).join('=');
    fs.writeFileSync(path.join(root, 'desktop-entry.log'), 'entry-ready');
    console.log(${JSON.stringify(marker)});
  `)
  assert.equal(result.exitCode, 0)
  assert.equal(result.signal, null)
  assert.equal(result.timedOut, false)
  assert.equal(result.closed, true)
  assert.equal(result.markerSeen, true)
  assert.equal(result.entryLog, 'entry-ready')
  await removed(result.root)
})

for (const output of [`prefix ${marker}`, `${marker} suffix`, ` ${marker}`, `${marker} `]) {
  test(`rejects a marker embedded in ${JSON.stringify(output)}`, async () => {
    await rejectsProbe(run(`console.log(${JSON.stringify(output)})`), async error => {
      assert.equal(error.result.exitCode, 0)
      assert.equal(error.result.markerSeen, false)
      await removed(error.result.root)
      return true
    })
  })
}

test('does not accept a readiness marker printed only on stderr', async () => {
  await rejectsProbe(run(`console.error(${JSON.stringify(marker)})`), error => {
    assert.equal(error.result.markerSeen, false)
    return true
  })
})

test('matches a fragmented CRLF marker and a final line without newline', async () => {
  for (const ending of ['\r\n', '']) {
    const result = await run(`
      process.stdout.write('DSH_');
      setTimeout(() => process.stdout.write('PROBE_READY' + ${JSON.stringify(ending)}), 10);
    `)
    assert.equal(result.markerSeen, true)
    await removed(result.root)
  }
})

test('rejects nonzero exit even after an exact marker', async () => {
  await rejectsProbe(run(`console.log(${JSON.stringify(marker)}); process.exitCode = 7`), async error => {
    assert.equal(error.result.exitCode, 7)
    assert.equal(error.result.signal, null)
    assert.equal(error.result.timedOut, false)
    assert.equal(error.result.markerSeen, true)
    await removed(error.result.root)
    return true
  })
})

test('records timeout independently of a marker and awaits owned child close', async () => {
  let pid
  await rejectsProbe(run(`console.log(process.pid); console.log(${JSON.stringify(marker)}); setInterval(() => {}, 1000)`, 300), async error => {
    const result = error.result
    pid = Number(result.stdout.split('\n')[0])
    assert.ok(Number.isSafeInteger(pid) && pid > 0)
    assert.equal(result.timedOut, true)
    assert.equal(result.markerSeen, true)
    assert.equal(result.closed, true)
    assert.equal(result.cleanupError, undefined)
    assert.notEqual(result.exitCode, 0)
    await removed(result.root)
    return true
  })
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})

test('timeout terminates an owned descendant without touching another process', async () => {
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  const unrelatedClosed = new Promise(resolvePromise => unrelated.once('close', resolvePromise))
  let descendant
  try {
    await rejectsProbe(run(`
    const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    console.log(child.pid); console.log(${JSON.stringify(marker)}); setInterval(() => {}, 1000);
    `, 400), error => {
      descendant = Number(error.result.stdout.split('\n')[0])
      assert.equal(error.result.closed, true)
      assert.equal(error.result.cleanupError, undefined)
      return true
    })
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0))
    // Reaping the orphaned descendant can lag behind the direct child's close.
    for (let attempt = 0; attempt < 30; attempt++) {
      try { process.kill(descendant, 0) } catch (error) {
        assert.equal(error.code, 'ESRCH')
        return
      }
      await new Promise(resolvePromise => setTimeout(resolvePromise, 20))
    }
    assert.fail('owned descendant remained alive after probe timeout')
  } finally {
    unrelated.kill('SIGKILL')
    await unrelatedClosed
  }
})

test('a timed-out child that exits zero still fails qualification', { skip: process.platform === 'win32' }, async t => {
  const kill = process.kill.bind(process)
  t.mock.method(process, 'kill', (pid, signal) => kill(pid, pid < 0 && signal === 'SIGKILL' ? 'SIGTERM' : signal))
  await rejectsProbe(run(`
    process.on('SIGTERM', () => process.exit(0));
    console.log(${JSON.stringify(marker)}); setInterval(() => {}, 1000);
  `, 400), error => {
    assert.equal(error.result.timedOut, true)
    assert.equal(error.result.exitCode, 0)
    assert.equal(error.result.signal, null)
    assert.equal(error.result.closed, true)
  })
})

test('preserves a tree cleanup failure even after the direct child is closed', { skip: process.platform === 'win32' }, async t => {
  const failure = Object.assign(new Error('group kill denied'), { code: 'EPERM' })
  t.mock.method(process, 'kill', () => { throw failure })
  await rejectsProbe(run('setInterval(() => {}, 1000)', 150), async error => {
    assert.equal(error.result.timedOut, true)
    assert.equal(error.result.cleanupError, failure)
    assert.equal(error.result.closed, true)
    assert.equal(error.cause, failure)
    assert.equal(error.result.rootPreserved, true)
    await access(error.result.root)
    await rm(error.result.root, { recursive: true, force: true })
  })
})

test('entry-log read failure does not replace the probe exit failure', async () => {
  await rejectsProbe(run(`
    const fs = require('node:fs'); const path = require('node:path');
    const root = process.argv.find(arg => arg.startsWith('--dsh-package-smoke-root=')).slice('--dsh-package-smoke-root='.length);
    fs.mkdirSync(path.join(root, 'desktop-entry.log')); process.exitCode = 7;
  `), async error => {
    assert.equal(error.result.exitCode, 7)
    assert.equal(error.result.entryLogError.code, 'EISDIR')
    assert.match(error.message, /exitCode=7/u)
    await removed(error.result.root)
  })
})

test('root cleanup failure preserves the original probe failure and its evidence', { skip: process.platform === 'win32' }, async () => {
  let root
  try {
    await rejectsProbe(run(`
      const fs = require('node:fs'); const path = require('node:path');
      const root = process.argv.find(arg => arg.startsWith('--dsh-package-smoke-root=')).slice('--dsh-package-smoke-root='.length);
      fs.writeFileSync(path.join(root, 'retained'), 'evidence'); fs.chmodSync(root, 0o500); process.exitCode = 7;
    `), async error => {
      root = error.result.root
      assert.equal(error.result.exitCode, 7)
      assert.equal(error.result.rootPreserved, true)
      assert.equal(error.rootCleanupError.code, 'EACCES')
      assert.match(error.message, /exitCode=7/u)
      await access(root)
    })
  } finally {
    if (root) {
      await chmod(root, 0o700)
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('reports a failed process start and removes its private root', async () => {
  await rejectsProbe(runElectronPackageProbe({
    executable: join(tmpdir(), `missing-probe-${randomUUID()}`), args: [], marker, timeoutMs: 1000,
  }), async error => {
    assert.equal(error.result.startError.code, 'ENOENT')
    assert.equal(error.result.closed, true)
    assert.equal(error.result.timedOut, false)
    await removed(error.result.root)
    return true
  })
})

test('scrubs Node/Electron overrides and secret variables while retaining ordinary values', async () => {
  const values = {
    NODE_OPTIONS: '--invalid-option-that-must-not-reach-node', ELECTRON_RUN_AS_NODE: '1',
    ODSH_PROBE_TOKEN: 'must-not-reach-child', ODSH_PROBE_LABEL: 'retained',
  }
  const previous = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]))
  Object.assign(process.env, values)
  try {
    const result = await run(`
      console.log(JSON.stringify({ node: process.env.NODE_OPTIONS ?? null, electron: process.env.ELECTRON_RUN_AS_NODE ?? null,
        token: process.env.ODSH_PROBE_TOKEN ?? null, label: process.env.ODSH_PROBE_LABEL, logging: process.env.ELECTRON_ENABLE_LOGGING }));
      console.log(${JSON.stringify(marker)});
    `)
    assert.deepEqual(JSON.parse(result.stdout.split('\n')[0]), {
      node: null, electron: null, token: null, label: 'retained', logging: '1',
    })
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('bounds stdout, stderr, and entry logs while still detecting a later exact marker', async () => {
  const result = await run(`
    const fs = require('node:fs'); const path = require('node:path');
    const root = process.argv.find(arg => arg.startsWith('--dsh-package-smoke-root=')).slice('--dsh-package-smoke-root='.length);
    fs.writeFileSync(path.join(root, 'desktop-entry.log'), 'x'.repeat(2 * 1024 * 1024));
    process.stdout.write('x'.repeat(2 * 1024 * 1024) + '\\n');
    process.stderr.write('x'.repeat(2 * 1024 * 1024));
    console.log(${JSON.stringify(marker)});
  `)
  for (const field of ['stdout', 'stderr', 'entryLog']) {
    assert.equal(Buffer.byteLength(result[field]), 1024 * 1024)
    assert.equal(result[`${field}Truncated`], true)
  }
  assert.equal(result.markerSeen, true)
  await removed(result.root)
})

test('rejects invalid readiness criteria before starting a process', async () => {
  await assert.rejects(runElectronPackageProbe({ executable: process.execPath, args: [], marker: 'one\ntwo', timeoutMs: 10 }), /one non-empty line/)
  await assert.rejects(runElectronPackageProbe({ executable: process.execPath, args: [], marker, timeoutMs: 0 }), /positive integer/)
})
