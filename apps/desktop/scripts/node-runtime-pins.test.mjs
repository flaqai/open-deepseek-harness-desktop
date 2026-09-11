import assert from 'node:assert/strict'
import test from 'node:test'
import { nodeArchiveSha256ByTarget, nodeVersion } from './node-runtime-pins.mjs'

test('pins the official Node 24.17.0 desktop runtime archives', () => {
  assert.equal(nodeVersion, '24.17.0')
  assert.deepEqual(nodeArchiveSha256ByTarget, {
    'darwin-arm64': '4fc3266a3702eebc39cc37661cf4eeceeade307e242ab64e4d7ce7949197e11f',
    'darwin-x64': '80da552fe037290cb130e9dea590f5eeeb7aa450636f0c89ab41415511c1ec27',
    'linux-x64': 'ab343a1b747c7cbf3630dfd7dbf818c5423fab2eb4f5ad1afc896f6bd121a917',
    'win32-x64': 'f2aa33b35b75aca5f3f7b85675a6f6423201053e9381911e64961f3bda2528ab',
  })
})

test('keeps every runtime digest in canonical SHA-256 form', () => {
  assert.deepEqual(Object.keys(nodeArchiveSha256ByTarget).sort(), [
    'darwin-arm64',
    'darwin-x64',
    'linux-x64',
    'win32-x64',
  ])
  for (const digest of Object.values(nodeArchiveSha256ByTarget)) {
    assert.match(digest, /^[0-9a-f]{64}$/)
  }
})
