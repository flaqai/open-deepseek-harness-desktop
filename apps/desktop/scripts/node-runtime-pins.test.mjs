import assert from 'node:assert/strict'
import test from 'node:test'
import { nodeRuntimeArchivesByTarget, nodeVersion } from './node-runtime-pins.mjs'

test('pins the official Node 24.17.0 desktop runtime archives', () => {
  assert.equal(nodeVersion, '24.17.0')
  assert.deepEqual(nodeRuntimeArchivesByTarget, {
    'darwin-arm64': {
      name: 'node-v24.17.0-darwin-arm64.tar.gz',
      sha256: '4fc3266a3702eebc39cc37661cf4eeceeade307e242ab64e4d7ce7949197e11f',
    },
    'darwin-x64': {
      name: 'node-v24.17.0-darwin-x64.tar.gz',
      sha256: '80da552fe037290cb130e9dea590f5eeeb7aa450636f0c89ab41415511c1ec27',
    },
    'linux-x64': {
      name: 'node-v24.17.0-linux-x64.tar.gz',
      sha256: 'e0472427aa791ad80bdc426ff7cc73cdd28ed0f616d1ff9689a23a7f47f1265f',
    },
    'win32-x64': {
      name: 'node-v24.17.0-win-x64.zip',
      sha256: 'f2aa33b35b75aca5f3f7b85675a6f6423201053e9381911e64961f3bda2528ab',
    },
  })
})

test('keeps every runtime digest in canonical SHA-256 form', () => {
  assert.deepEqual(Object.keys(nodeRuntimeArchivesByTarget).sort(), [
    'darwin-arm64',
    'darwin-x64',
    'linux-x64',
    'win32-x64',
  ])
  for (const archive of Object.values(nodeRuntimeArchivesByTarget)) {
    assert.match(archive.name, new RegExp(`^node-v${nodeVersion}-.+\\.(?:tar\\.gz|zip)$`))
    assert.match(archive.sha256, /^[0-9a-f]{64}$/)
  }
})
