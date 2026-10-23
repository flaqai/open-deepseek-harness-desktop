import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { nodeRuntimeArchivesByTarget, nodeVersion } from './node-runtime-pins.mjs'

test('pins the official Node 24.22.1 desktop runtime archives', () => {
  assert.equal(nodeVersion, '24.22.1')
  assert.deepEqual(nodeRuntimeArchivesByTarget, {
    'darwin-arm64': {
      name: 'node-v24.22.1-darwin-arm64.tar.gz',
      sha256: '89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7',
    },
    'darwin-x64': {
      name: 'node-v24.22.1-darwin-x64.tar.gz',
      sha256: 'd132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035',
    },
    'linux-x64': {
      name: 'node-v24.22.1-linux-x64.tar.gz',
      sha256: 'eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c',
    },
    'win32-x64': {
      name: 'node-v24.22.1-win-x64.zip',
      sha256: 'd2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5',
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

test('keeps both workspace runtime locks and first-deployment validation on the packaged Node', async () => {
  const targets = { 'mac-arm64': 'darwin-arm64', 'mac-x64': 'darwin-x64', 'win-x64': 'win32-x64', 'linux-x64': 'linux-x64' }
  for (const path of ['./primary-runtime-lock.json', '../../../scripts/primary-runtime/lock.json']) {
    const lock = JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
    assert.equal(lock.nodeVersion, nodeVersion, path)
    for (const [target, packagedTarget] of Object.entries(targets)) {
      const archive = nodeRuntimeArchivesByTarget[packagedTarget]
      assert.equal(`node-v${nodeVersion}-${lock.targets[target].nodeArchive}`, archive.name, `${path}: ${target}`)
      assert.equal(lock.targets[target].nodeSha256, archive.sha256, `${path}: ${target}`)
    }
    if (lock.targets['linux-arm64'] !== undefined) {
      assert.equal(lock.targets['linux-arm64'].nodeSha256, '33c37be234ba8bee041961047b19160f4d7d0f164e8e246f78bdd10feff148b3')
    }
  }
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.ok(main.includes(`candidate.identity.nodeVersion === '${nodeVersion}'`), 'first deployment must accept the newly built Profile')
})

function assertLiteralWorkflowPins(source, label) {
  const versions = { 22: '22.23.4', 24: nodeVersion, 26: '26.12.1' }
  for (const match of source.matchAll(/^\s*(?:PRIMARY_NODE_VERSION|node-version):\s*['"]?(22|24|26)([.\d]*)['"]?\s*$/gmu)) {
    assert.equal(match[1] + match[2], versions[match[1]], `${label}: unsupported security baseline`)
  }
}

test('build, publication and NAS image inputs use the fixed security runtime', async () => {
  const workflows = new URL('../../../.github/workflows/', import.meta.url)
  for (const name of await readdir(workflows)) {
    if (name.endsWith('.yml')) assertLiteralWorkflowPins(await readFile(new URL(name, workflows), 'utf8'), name)
  }
  const dockerfile = await readFile(new URL('../../../deploy/nas/Dockerfile', import.meta.url), 'utf8')
  const images = [...dockerfile.matchAll(/^FROM node:(\S+)/gmu)].map(match => match[1])
  assert.deepEqual(images, [`${nodeVersion}-bookworm-slim`, `${nodeVersion}-bookworm-slim`])
  const compose = await readFile(new URL('../../../deploy/nas/compose.yaml', import.meta.url), 'utf8')
  assert.deepEqual([...compose.matchAll(/^\s*image: node:(\S+)/gmu)].map(match => match[1]), [
    `${nodeVersion}-alpine`, `${nodeVersion}-alpine`,
  ])
})

test('workflow security checks reject stale and floating literal Node pins', () => {
  for (const source of ["PRIMARY_NODE_VERSION: '24.17.0'", 'node-version: 24', 'node-version: 22.23.3', 'node-version: 26.12.0']) {
    assert.throws(() => assertLiteralWorkflowPins(source, 'negative control'), /unsupported security baseline/u)
  }
})
