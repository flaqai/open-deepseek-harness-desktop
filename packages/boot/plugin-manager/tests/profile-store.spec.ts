import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { initProfile } from '@deepseek-ai/dsh-app-boot'
import { runProfilePnpm } from '../src/operations.ts'

it('installs from the plugin page using the existing Profile store instead of the system store', async () => {
  const home = mkdtempSync(join(tmpdir(), 'plugin store 中文-'))
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  const dir = join(home, 'profiles', 'web')
  const anchor = join(home, 'package.json')
  writeFileSync(anchor, '{}')
  initProfile(dir, [])
  const bundle = join(home, 'local-bundle')
  mkdirSync(bundle)
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'store-fixture', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), '[]\n')
  const pnpm = fileURLToPath(new URL('../../../../apps/desktop/node_modules/pnpm/bin/pnpm.mjs', import.meta.url))
  const store = join(home, '.pnpm-store')
  const seed = spawnSync(process.execPath, [pnpm, 'add', '--offline', '--ignore-scripts', '--store-dir', store, `link:${bundle}`], { cwd: dir, encoding: 'utf8' })
  expect(seed.status, seed.stdout + seed.stderr).toBe(0)
  const metadata = readFileSync(join(dir, 'node_modules', '.modules.yaml'), 'utf8')
  const result = await runProfilePnpm({ home, dir, profile: 'web', cwd: home, installAnchor: anchor }, ['add', '--offline', '--ignore-scripts', `link:${bundle}`], {
    execution: 'service', command: process.execPath, args: [pnpm], outputBytes: 8192, activateNewBundles: false,
    env: { npm_config_store_dir: join(home, 'wrong-global-store'), PNPM_CONFIG_STORE_DIR: join(home, 'another-global-store') },
  })
  expect(result.exitCode, result.output).toBe(0)
  expect(result.output).not.toContain('ERR_PNPM_UNEXPECTED_STORE')
  expect(readFileSync(join(dir, 'node_modules', '.modules.yaml'), 'utf8')).toBe(metadata)
})
