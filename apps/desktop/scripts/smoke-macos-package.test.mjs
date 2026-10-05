import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { verifyCodeSignature, verifyHelperLayout } from './smoke-macos-package.mjs'

test('macOS native startup shares the isolated probe and keeps its fifteen-second deadline', () => {
  const source = readFileSync(new URL('./smoke-macos-package.mjs', import.meta.url), 'utf8')
  assert.match(source, /await runElectronPackageProbe\(/u)
  assert.match(source, /marker: 'DSH_NATIVE_SMOKE_READY', timeoutMs: 15000/u)
  assert.match(source, /verify-prebuilt-profile\.mjs/u)
  assert.match(source, /for \(const input of process\.argv\.slice\(2\)\) await smokeMacPackage\(input\)/u)
})

test('deep signature verification tolerates a large final app while remaining bounded', () => {
  const app = '/tmp/DeepSeek Harness Desktop.app'
  let attempts = 0
  const run = (command, args, options) => {
    attempts += 1
    assert.equal(command, '/usr/bin/codesign')
    assert.deepEqual(args, ['--verify', '--deep', '--strict', app])
    if (options.timeout < 120000) {
      const error = new Error('spawnSync /usr/bin/codesign ETIMEDOUT')
      error.code = 'ETIMEDOUT'
      throw error
    }
    assert.ok(options.timeout <= 300000)
  }
  assert.doesNotThrow(() => verifyCodeSignature(app, run))
  assert.equal(attempts, 1)
})

test('native Helper lookup accepts display branding but rejects CFBundleName mismatch and missing helpers', { skip: process.platform !== 'darwin' }, () => {
  const app = mkdtempSync(join(tmpdir(), 'dsh-helper-layout-'))
  const plist = value => `<?xml version="1.0"?><plist version="1.0"><dict>${Object.entries(value).map(([key, text]) => `<key>${key}</key><string>${text}</string>`).join('')}</dict></plist>`
  const executable = path => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, ''); chmodSync(path, 0o755) }
  const info = name => writeFileSync(join(app, 'Contents/Info.plist'), plist({ CFBundleName: name, CFBundleDisplayName: 'Open DeepSeek Harness Desktop', CFBundleExecutable: 'Open DeepSeek Harness Desktop' }))
  try {
    executable(join(app, 'Contents/MacOS/Open DeepSeek Harness Desktop'))
    for (const suffix of ['', ' (GPU)', ' (Plugin)', ' (Renderer)']) {
      const helper = `Open DeepSeek Harness Desktop Helper${suffix}`
      const contents = join(app, 'Contents/Frameworks', `${helper}.app/Contents`)
      executable(join(contents, 'MacOS', helper))
      writeFileSync(join(contents, 'Info.plist'), plist({ CFBundleExecutable: helper }))
    }
    info('Open DeepSeek Harness Desktop')
    assert.equal(verifyHelperLayout(app), 'Open DeepSeek Harness Desktop')
    info('Mismatched Desktop Name')
    assert.throws(() => verifyHelperLayout(app), /CFBundleName=Mismatched Desktop Name: missing executable/)
    info('Open DeepSeek Harness Desktop')
    rmSync(join(app, 'Contents/Frameworks/Open DeepSeek Harness Desktop Helper (GPU).app'), { recursive: true })
    assert.throws(() => verifyHelperLayout(app), /missing executable Open DeepSeek Harness Desktop Helper \(GPU\)/)
  } finally {
    rmSync(app, { recursive: true, force: true })
  }
})
