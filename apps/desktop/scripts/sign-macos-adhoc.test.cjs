const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createCodesignArgs } = require('./sign-macos-adhoc.cjs')

test('builds one deep ad-hoc signing invocation for an application bundle', () => {
  assert.deepEqual(createCodesignArgs('/tmp/Open DeepSeek Harness Desktop.app'), [
    '--force', '--deep', '--sign', '-', '--timestamp=none', '/tmp/Open DeepSeek Harness Desktop.app',
  ])
})

test('rejects relative paths and non-application targets', () => {
  assert.throws(() => createCodesignArgs('Open DeepSeek Harness Desktop.app'), /absolute \.app/)
  assert.throws(() => createCodesignArgs('/tmp/Open DeepSeek Harness Desktop'), /absolute \.app/)
})
