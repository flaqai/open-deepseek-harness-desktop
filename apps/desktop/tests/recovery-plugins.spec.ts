import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isRecoveryPluginPackageName, readRecoveryPluginInventory } from '../src/recovery-plugins.ts'

describe('Desktop recovery plugin inventory', () => {
  it('lists direct external plugins without exposing paths and protects template bundles', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-recovery-plugins-'))
    const profile = join(home, 'profiles', 'web')
    await mkdir(join(profile, 'node_modules', 'example-plugin'), { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      dependencies: {
        'example-plugin': `file:${join(home, 'bundled-plugins', 'example-plugin-1.2.3.tgz')}`,
        '@scope/registry-plugin': '^2.0.0',
        'first-bundle-plugin': '^3.0.0',
      },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'first-bundle-plugin', 'example-plugin'] } },
    }))
    await writeFile(join(profile, 'node_modules', 'example-plugin', 'package.json'), JSON.stringify({
      name: 'example-plugin', version: '1.2.3',
    }))
    await mkdir(join(home, 'profile-health'), { recursive: true })
    await writeFile(join(home, 'profile-health', 'web.diagnostics.json'), JSON.stringify({
      schema: 'dsh/profile-diagnostic/v2', profile: 'web', issues: [{
        code: 'profile.module-resolution', attribution: { rootPackage: 'example-plugin' },
      }],
    }))

    await expect(readRecoveryPluginInventory(home)).resolves.toEqual({
      plugins: [
        { packageName: 'first-bundle-plugin', source: 'registry', status: 'unverified', installation: 'missing', activation: 'unverified' },
        {
          packageName: 'example-plugin', version: '1.2.3', source: 'bundled',
          status: 'unverified', installation: 'installed', activation: 'unverified', recordedDiagnosticCode: 'profile.module-resolution',
        },
        { packageName: '@scope/registry-plugin', source: 'registry', status: 'unverified', installation: 'missing', activation: 'unverified' },
      ],
      protectedCount: 2,
    })
  })

  it('attributes a live missing archive separately from the blocked installer and paused plugins', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-paused-plugins-'))
    await mkdir(join(home, 'profiles', 'web'), { recursive: true })
    await writeFile(join(home, 'profiles', 'web', 'package.json'), JSON.stringify({ dependencies: {
      dshmarket: 'file:D:\\App\\resources\\bundled-plugins\\dshmarket-1.55.0%2Etgz',
      bridge: '2.0.2', other: '1.0.0',
    } }))
    const inventory = await readRecoveryPluginInventory(home, {
      profilePaused: true, repairVersions: { dshmarket: '1.73.12', other: '2.0.0' },
      failure: { category: 'missing-local-archive', missingArchive: 'dshmarket-1.55.0.tgz', blockedPackage: 'bridge', causes: [] },
    })
    expect(inventory.plugins.find(x => x.packageName === 'dshmarket')).toMatchObject({
      status: 'attention', activation: 'paused', diagnosticCode: 'desktop.plugin-archive-missing', repairVersion: '1.73.12',
    })
    expect(inventory.plugins.find(x => x.packageName === 'bridge')).toMatchObject({ status: 'attention', diagnosticCode: 'desktop.plugin-operation-blocked' })
    expect(inventory.plugins.find(x => x.packageName === 'other')).toMatchObject({ status: 'paused', activation: 'paused' })
    expect(inventory.plugins.find(x => x.packageName === 'other')).not.toHaveProperty('repairVersion')
    const refreshed = await readRecoveryPluginInventory(home)
    expect(refreshed.plugins.every(x => x.status === 'unverified' && x.diagnosticCode === undefined)).toBe(true)
  })

  it('accepts package identities but rejects command and path input', () => {
    expect(isRecoveryPluginPackageName('@scope/plugin')).toBe(true)
    expect(isRecoveryPluginPackageName('plugin-name')).toBe(true)
    expect(isRecoveryPluginPackageName('../plugin')).toBe(false)
    expect(isRecoveryPluginPackageName('plugin --force')).toBe(false)
  })
})
