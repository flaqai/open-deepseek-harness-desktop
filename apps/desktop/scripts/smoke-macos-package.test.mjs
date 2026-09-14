import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { verifyHelperLayout } from './smoke-macos-package.mjs'

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
