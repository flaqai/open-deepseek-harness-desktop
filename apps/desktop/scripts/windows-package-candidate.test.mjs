import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const script = resolve(import.meta.dirname, 'windows-package-candidate.mjs')

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-windows-candidate-'))
  await mkdir(join(root, 'apps', 'desktop', 'scripts'), { recursive: true })
  await mkdir(join(root, 'apps', 'desktop', 'bundled-plugins'), { recursive: true })
  await mkdir(join(root, '.artifacts', 'desktop-windows'), { recursive: true })
  await writeFile(join(root, 'apps', 'desktop', 'main.ts'), 'export const value = 1\n')
  await writeFile(join(root, 'apps', 'desktop', 'scripts', 'smoke-windows-package.ps1'), 'Write-Host smoke\n')
  await writeFile(join(root, 'apps', 'desktop', 'bundled-plugins', 'plugin.tgz'), 'plugin-v1')
  await writeFile(join(root, '.artifacts', 'desktop-windows', 'DeepSeek-Harness-windows-x64.exe'), 'installer-v1')
  run('git', ['init', '-q'], root)
  run('git', ['config', 'user.name', 'fixture'], root)
  run('git', ['config', 'user.email', 'fixture@example.invalid'], root)
  run('git', ['add', '.'], root)
  run('git', ['commit', '-qm', 'fixture'], root)
  return {
    root,
    installer: join(root, '.artifacts', 'desktop-windows', 'DeepSeek-Harness-windows-x64.exe'),
    plugins: join(root, 'apps', 'desktop', 'bundled-plugins'),
    manifest: join(root, '.artifacts', 'desktop-windows', 'candidate.json'),
  }
}

test('verifies reusable candidates by packaged inputs, plugin bytes and installer identity', async () => {
  const item = await fixture()
  run(process.execPath, [script, 'create', item.root, item.installer, item.plugins, item.manifest], item.root)
  const document = JSON.parse(await readFile(item.manifest, 'utf8'))
  assert.equal(document.schema, 'open-dsh/windows-package-candidate/v1')
  run(process.execPath, [script, 'verify', item.root, item.installer, item.plugins, item.manifest], item.root)

  await writeFile(join(item.root, 'apps', 'desktop', 'scripts', 'smoke-windows-package.ps1'), 'Write-Host fixed-smoke\n')
  run('git', ['add', '.'], item.root)
  run(process.execPath, [script, 'verify', item.root, item.installer, item.plugins, item.manifest], item.root)

  await writeFile(join(item.root, 'apps', 'desktop', 'main.ts'), 'export const value = 2\n')
  run('git', ['add', '.'], item.root)
  assert.throws(() => run(process.execPath, [script, 'verify', item.root, item.installer, item.plugins, item.manifest], item.root), /packagingInputDigest/u)
})

test('rejects changed plugin and installer bytes', async () => {
  const item = await fixture()
  run(process.execPath, [script, 'create', item.root, item.installer, item.plugins, item.manifest], item.root)
  await writeFile(join(item.plugins, 'plugin.tgz'), 'plugin-v2')
  assert.throws(() => run(process.execPath, [script, 'verify', item.root, item.installer, item.plugins, item.manifest], item.root), /bundledPluginDigest/u)
  await writeFile(join(item.plugins, 'plugin.tgz'), 'plugin-v1')
  await writeFile(item.installer, 'installer-v2')
  assert.throws(() => run(process.execPath, [script, 'verify', item.root, item.installer, item.plugins, item.manifest], item.root), /installer/u)
})

test('allows a committed smoke-only fix but rejects a changed packaging workflow', async () => {
  const item = await fixture()
  run(process.execPath, [script, 'create', item.root, item.installer, item.plugins, item.manifest], item.root)
  await writeFile(join(item.root, 'apps', 'desktop', 'scripts', 'smoke-windows-package.ps1'), 'Write-Host fixed-smoke\n')
  run('git', ['add', '.'], item.root)
  run('git', ['commit', '-qm', 'fix smoke'], item.root)
  run(process.execPath, [script, 'verify', item.root, item.installer, item.plugins, item.manifest], item.root)

  await mkdir(join(item.root, '.github', 'workflows'), { recursive: true })
  await writeFile(join(item.root, '.github', 'workflows', 'desktop-packages.yml'), 'jobs: changed\n')
  run('git', ['add', '.'], item.root)
  run('git', ['commit', '-qm', 'change packaging workflow'], item.root)
  assert.throws(() => run(process.execPath, [script, 'verify', item.root, item.installer, item.plugins, item.manifest], item.root), /candidate workflow changed/u)
})

test('creates a candidate identity when the Git index exceeds the default child-process buffer', async () => {
  const item = await fixture()
  const object = run('git', ['rev-parse', 'HEAD:apps/desktop/main.ts'], item.root).trim()
  const records = Array.from({ length: 15_000 }, (_, index) => {
    const suffix = String(index).padStart(5, '0')
    return `100644 ${object}\tpackages/runtime/generated-${suffix}-${'x'.repeat(40)}.js\n`
  }).join('')
  const update = spawnSync('git', ['update-index', '--index-info'], {
    cwd: item.root,
    encoding: 'utf8',
    input: records,
    maxBuffer: 8 * 1024 * 1024,
  })
  assert.equal(update.status, 0, update.stderr)
  const listing = spawnSync('git', ['ls-files', '-s'], {
    cwd: item.root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
  assert.equal(listing.status, 0, listing.stderr)
  assert.ok(listing.stdout.length > 1024 * 1024)

  run(process.execPath, [script, 'create', item.root, item.installer, item.plugins, item.manifest], item.root)
  const document = JSON.parse(await readFile(item.manifest, 'utf8'))
  assert.match(document.packagingInputDigest, /^[0-9a-f]{64}$/u)
})
