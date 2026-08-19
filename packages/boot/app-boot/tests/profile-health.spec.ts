import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  initProfile,
  inspectProfileDependencies,
  inspectOrphanedProfileBundles,
  listQuarantinedProfilePlugins,
  readProfileManifest,
  repairProfileDependencies,
  retryQuarantinedProfilePlugin,
  resolveProfileDir,
  SHARED_HOST_PACKAGES,
  uninstallQuarantinedProfilePlugin,
  writeProfileManifest,
} from '../src/index.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

function temporaryDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(path)
  return path
}

function writeManifest(path: string, manifest: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(manifest, undefined, 2)}\n`)
}

function stageHarness(): { anchor: string; packageDirs: Map<string, string> } {
  const appDir = join(temporaryDirectory('dsh-health-host-'), 'app')
  const packageDirs = new Map<string, string>()
  const dependencies: Record<string, string> = {}
  for (const packageName of SHARED_HOST_PACKAGES) {
    const packageDir = join(appDir, 'node_modules', packageName)
    writeManifest(join(packageDir, 'package.json'), { name: packageName, version: '0.1.0-rc.7' })
    packageDirs.set(packageName, packageDir)
    dependencies[packageName] = '0.1.0-rc.7'
  }
  const anchor = join(appDir, 'package.json')
  writeManifest(anchor, { name: 'dsh-test-app', version: '1.0.0', dependencies })
  return { anchor, packageDirs }
}

function stageProfile(home: string, pluginManifest: Record<string, unknown>): { profileDir: string; pluginDir: string } {
  const profileDir = resolveProfileDir('web', home)
  initProfile(profileDir, ['@deepseek-ai/dsh-base'])
  const pluginDir = join(profileDir, 'node_modules', 'fixture-plugin')
  writeManifest(join(pluginDir, 'package.json'), {
    name: 'fixture-plugin',
    version: '2.3.4',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    ...pluginManifest,
  })
  writeProfileManifest(profileDir, {
    name: 'dsh-profile-web',
    dependencies: { 'fixture-plugin': '^2.3.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'fixture-plugin'] } },
  })
  return { profileDir, pluginDir }
}

function stageDuplicate(ownerDir: string, packageName: string, version = '0.1.0-rc.6'): string {
  const packageDir = join(ownerDir, 'node_modules', packageName)
  writeManifest(join(packageDir, 'package.json'), { name: packageName, version })
  return packageDir
}

function stageQuarantineRecord(home: string): { quarantineId: string } {
  const quarantineId = '00000000-0000-4000-8000-000000000001'
  writeManifest(join(home, 'quarantine', 'profile-plugins.json'), {
    schema: 1,
    plugins: [{
      quarantineId,
      profile: 'web',
      packageName: 'fixture-plugin',
      packageSpec: '^2.3.0',
      installedVersion: '2.3.4',
      bundleIndex: 1,
      quarantinedAt: '2026-08-19T01:02:03.000Z',
      reason: 'orphaned-bundle',
      conflicts: [],
    }],
  })
  return { quarantineId }
}

function stageLockfile(profileDir: string, dependencies: readonly string[]): string {
  const path = join(profileDir, 'pnpm-lock.yaml')
  const entries = dependencies
    .map(name => `      ${name}:\n        specifier: ^1.0.0\n        version: 1.0.0`)
    .join('\n')
  writeFileSync(path, `lockfileVersion: '9.0'\n\nimporters:\n  .:\n    dependencies:\n${entries}\n`)
  return path
}

describe('profile shared Host dependency inspection', () => {
  it('finds direct and optional duplicate edges while leaving peer declarations alone', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { pluginDir } = stageProfile(home, {
      dependencies: { '@deepseek-ai/dsh-tools': '^0.1.0-rc.6' },
      optionalDependencies: { '@deepseek-ai/dsh-llm': '^0.1.0-rc.6' },
      peerDependencies: { '@deepseek-ai/cordis': '^4.0.0' },
    })
    stageDuplicate(pluginDir, '@deepseek-ai/dsh-tools')
    stageDuplicate(pluginDir, '@deepseek-ai/dsh-llm')
    stageDuplicate(pluginDir, '@deepseek-ai/cordis', '4.0.1')

    const conflicts = inspectProfileDependencies({ binName: 'test', profile: 'web', installAnchor: anchor, home })
    expect(conflicts.map(conflict => [conflict.dependency, conflict.declaredIn])).toEqual([
      ['@deepseek-ai/dsh-tools', 'dependencies'],
      ['@deepseek-ai/dsh-llm', 'optionalDependencies'],
    ])
    expect(conflicts.every(conflict => conflict.compatible)).toBe(true)
  })

  it('walks transitive dependencies and reports the owning root plugin', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { pluginDir } = stageProfile(home, { dependencies: { helper: '^1.0.0' } })
    const helperDir = join(pluginDir, 'node_modules', 'helper')
    writeManifest(join(helperDir, 'package.json'), {
      name: 'helper',
      version: '1.0.0',
      dependencies: { '@deepseek-ai/dsh-system-prompt': '^0.1.0-rc.6' },
    })
    stageDuplicate(helperDir, '@deepseek-ai/dsh-system-prompt')

    const [conflict] = inspectProfileDependencies({ binName: 'test', profile: 'web', installAnchor: anchor, home })
    expect(conflict).toMatchObject({
      rootPackage: 'fixture-plugin',
      dependencyChain: ['fixture-plugin', 'helper', '@deepseek-ai/dsh-system-prompt'],
    })
  })

  it('detects a shared Host package installed directly in the profile', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const profileDir = resolveProfileDir('web', home)
    initProfile(profileDir, ['@deepseek-ai/dsh-base'])
    writeProfileManifest(profileDir, {
      name: 'dsh-profile-web',
      dependencies: { '@deepseek-ai/dsh-tools': '^0.1.0-rc.6' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    })
    stageDuplicate(profileDir, '@deepseek-ai/dsh-tools')

    expect(inspectProfileDependencies({ binName: 'test', profile: 'web', installAnchor: anchor, home }))
      .toEqual([expect.objectContaining({
        rootPackage: '@deepseek-ai/dsh-tools',
        dependencyChain: ['@deepseek-ai/dsh-tools'],
        dependency: '@deepseek-ai/dsh-tools',
        compatible: true,
      })])
  })

  it('detects an equal-version package when its physical instance differs from the Host', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { pluginDir } = stageProfile(home, {
      dependencies: { '@deepseek-ai/dsh-tools': '0.1.0-rc.7' },
    })
    stageDuplicate(pluginDir, '@deepseek-ai/dsh-tools', '0.1.0-rc.7')

    expect(inspectProfileDependencies({ binName: 'test', profile: 'web', installAnchor: anchor, home }))
      .toEqual([expect.objectContaining({
        dependency: '@deepseek-ai/dsh-tools',
        hostVersion: '0.1.0-rc.7',
        compatible: true,
      })])
  })

  it('uses the profile module fallback for a transitive Host package absent from the CLI anchor', () => {
    const { anchor, packageDirs } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const hostAttachment = join(temporaryDirectory('dsh-health-transitive-host-'), 'dsh-attachment')
    writeManifest(join(hostAttachment, 'package.json'), {
      name: '@deepseek-ai/dsh-attachment',
      version: '0.1.0-rc.7',
    })
    rmSync(packageDirs.get('@deepseek-ai/dsh-attachment')!, { recursive: true })
    const fallback = join(home, 'profiles', 'node_modules', '@deepseek-ai/dsh-attachment')
    mkdirSync(dirname(fallback), { recursive: true })
    symlinkSync(hostAttachment, fallback, 'junction')
    const { pluginDir } = stageProfile(home, {
      dependencies: { '@deepseek-ai/dsh-attachment': '^0.1.0-rc.6' },
    })
    stageDuplicate(pluginDir, '@deepseek-ai/dsh-attachment')

    expect(inspectProfileDependencies({ binName: 'test', profile: 'web', installAnchor: anchor, home }))
      .toEqual([expect.objectContaining({
        dependency: '@deepseek-ai/dsh-attachment',
        hostPath: realpathSync.native(hostAttachment),
        compatible: true,
      })])
  })
})

describe('profile composition inspection', () => {
  it('detects and quarantines a third-party bundle left outside profile dependencies', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {
      dependencies: { '@deepseek-ai/dsh-tools': '^0.1.0-rc.6' },
    })
    const manifest = readProfileManifest('test', profileDir)
    writeProfileManifest(profileDir, { ...manifest, dependencies: {} })

    expect(inspectOrphanedProfileBundles({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
    })).toEqual([
      expect.objectContaining({
        packageName: 'fixture-plugin',
        bundleIndex: 1,
        installedVersion: '2.3.4',
        resolvedPath: realpathSync.native(pluginDir),
      }),
    ])

    const result = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      now: () => new Date('2026-08-19T06:30:00.000Z'),
      runPackageManager: () => {
        if (readProfileManifest('test', profileDir).dsh?.profile?.bundles?.includes('fixture-plugin') !== true) {
          rmSync(pluginDir, { recursive: true, force: true })
        }
        return { exitCode: 0 }
      },
    })

    expect(result).toMatchObject({
      status: 'quarantined',
      conflicts: [],
      orphanedBundles: [{ packageName: 'fixture-plugin' }],
      quarantined: [{ packageName: 'fixture-plugin', reason: 'orphaned-bundle' }],
    })
    expect(readProfileManifest('test', profileDir).dsh?.profile?.bundles).not.toContain('fixture-plugin')
    expect(inspectOrphanedProfileBundles({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
    })).toEqual([])
  })

  it('retries orphan pruning with a one-shot release-age override before reporting quarantine', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {})
    const manifest = readProfileManifest('test', profileDir)
    writeProfileManifest(profileDir, { ...manifest, dependencies: {} })
    const calls: string[][] = []

    const result = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: (args) => {
        calls.push([...args])
        if (args.includes('--config.minimumReleaseAge=0')) {
          rmSync(pluginDir, { recursive: true, force: true })
          return { exitCode: 0 }
        }
        return {
          exitCode: 1,
          diagnostic: '[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] minimum release age rejected an unrelated package',
        }
      },
    })

    expect(result).toMatchObject({
      status: 'quarantined',
      quarantined: [{ packageName: 'fixture-plugin', reason: 'orphaned-bundle' }],
    })
    expect(calls).toEqual([
      ['install'],
      ['install', '--config.minimumReleaseAge=0'],
    ])
    expect(readProfileManifest('test', profileDir).dsh?.profile?.bundles).not.toContain('fixture-plugin')
  })

  it('recovers a cleared quarantine record only after its interrupted physical cleanup succeeds', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {})
    const manifest = readProfileManifest('test', profileDir)
    writeProfileManifest(profileDir, { ...manifest, dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } })
    const healthDir = join(home, 'profile-health')
    mkdirSync(healthDir, { recursive: true })
    writeManifest(join(healthDir, 'web.json'), {
      schema: 'dsh/profile-dependency-repair/v1',
      profile: 'web',
      status: 'quarantined',
      conflicts: [],
      diagnostic: '[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] cleanup interrupted',
      orphanedBundles: [{ profile: 'web', packageName: 'fixture-plugin', bundleIndex: 1 }],
      quarantined: [{
        quarantineId: '00000000-0000-4000-8000-000000000001',
        profile: 'web',
        packageName: 'fixture-plugin',
        packageSpec: '^2.3.0',
        installedVersion: '2.3.4',
        bundleIndex: 1,
        quarantinedAt: '2026-08-19T01:02:03.000Z',
        reason: 'orphaned-bundle',
        conflicts: [],
      }],
    })
    const calls: string[][] = []

    const result = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: (args) => {
        calls.push([...args])
        rmSync(pluginDir, { recursive: true, force: true })
        return { exitCode: 0 }
      },
    })

    expect(calls).toEqual([['install', '--config.minimumReleaseAge=0']])
    expect(result.status).toBe('quarantined')
    expect(listQuarantinedProfilePlugins(home)).toEqual([
      expect.objectContaining({ packageName: 'fixture-plugin' }),
    ])
    expect(existsSync(pluginDir)).toBe(false)
  })

  it('removes interrupted plugin residue and relinks Host identities when pnpm cleanup crashes', () => {
    const { anchor, packageDirs } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {})
    const manifest = readProfileManifest('test', profileDir)
    writeProfileManifest(profileDir, { ...manifest, dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } })
    const profileTools = stageDuplicate(profileDir, '@deepseek-ai/dsh-tools')
    const healthDir = join(home, 'profile-health')
    mkdirSync(healthDir, { recursive: true })
    writeManifest(join(healthDir, 'web.json'), {
      schema: 'dsh/profile-dependency-repair/v1',
      profile: 'web',
      status: 'failed',
      conflicts: [],
      diagnostic: 'pnpm peer resolver crashed',
      orphanedBundles: [{ profile: 'web', packageName: 'fixture-plugin', bundleIndex: 1 }],
      quarantined: [],
    })

    const result = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      now: () => new Date('2026-08-19T01:02:03.000Z'),
      runPackageManager: () => ({ exitCode: 1, diagnostic: 'pnpm peer resolver crashed' }),
    })

    expect(result).toMatchObject({
      status: 'quarantined',
      diagnostic: expect.stringContaining('removed directly'),
    })
    expect(existsSync(pluginDir)).toBe(false)
    expect(realpathSync.native(profileTools)).toBe(realpathSync.native(packageDirs.get('@deepseek-ai/dsh-tools')!))
    expect(listQuarantinedProfilePlugins(home)).toEqual([
      expect.objectContaining({
        packageName: 'fixture-plugin',
        quarantinedAt: '2026-08-19T01:02:03.000Z',
      }),
    ])
  })
})

describe('profile shared Host dependency repair', () => {
  it('prunes stale lockfile importer dependencies without invoking pnpm', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir } = stageProfile(home, {})
    const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
    writeFileSync(
      workspacePath,
      readFileSync(workspacePath, 'utf8').replace('dedupePeerDependents: false\n', ''),
    )
    const lockfilePath = stageLockfile(profileDir, ['fixture-plugin', 'removed-plugin'])
    let installs = 0

    const result = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: () => {
        installs += 1
        return { exitCode: 0 }
      },
    })

    expect(result).toMatchObject({
      status: 'repaired',
      diagnostic: 'removed stale lockfile dependencies: removed-plugin',
    })
    expect(installs).toBe(0)
    expect(readFileSync(workspacePath, 'utf8')).toContain('dedupePeerDependents: false')
    expect(readFileSync(lockfilePath, 'utf8')).toContain('fixture-plugin:')
    expect(readFileSync(lockfilePath, 'utf8')).not.toContain('removed-plugin:')
  })

  it('writes managed link overrides, preserves YAML comments, and converges a compatible duplicate', () => {
    const { anchor, packageDirs } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {
      dependencies: { '@deepseek-ai/dsh-tools': '^0.1.0-rc.6' },
    })
    const duplicate = stageDuplicate(pluginDir, '@deepseek-ai/dsh-tools')
    const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
    writeFileSync(workspacePath, `${readFileSync(workspacePath, 'utf8')}\n# keep me\noverrides:\n  unrelated: 1.2.3\n`)

    let installs = 0
    const result = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: () => {
        installs += 1
        rmSync(duplicate, { recursive: true })
        symlinkSync(packageDirs.get('@deepseek-ai/dsh-tools')!, duplicate, 'junction')
        return { exitCode: 0 }
      },
    })

    expect(result.status).toBe('repaired')
    expect(installs).toBe(1)
    const workspace = readFileSync(workspacePath, 'utf8')
    expect(workspace).toContain('# keep me')
    expect(workspace).toContain('unrelated: 1.2.3')
    expect(workspace).toContain('"@deepseek-ai/dsh-tools": link:../node_modules/@deepseek-ai/dsh-tools')
    expect(inspectProfileDependencies({ binName: 'test', profile: 'web', installAnchor: anchor, home })).toEqual([])
  })

  it('quarantines an incompatible plugin even when its Loader bundle was disabled elsewhere', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {
      dependencies: { '@deepseek-ai/dsh-tools': '^9.0.0' },
    })
    stageDuplicate(pluginDir, '@deepseek-ai/dsh-tools', '9.0.0')

    const result = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      now: () => new Date('2026-08-19T01:02:03.000Z'),
      runPackageManager: () => {
        if (readProfileManifest('test', profileDir).dependencies?.['fixture-plugin'] === undefined) {
          rmSync(pluginDir, { recursive: true, force: true })
        }
        return { exitCode: 0 }
      },
    })

    expect(result.status).toBe('quarantined')
    expect(readProfileManifest('test', profileDir).dependencies).toEqual({})
    expect(readProfileManifest('test', profileDir).dsh?.profile?.bundles).not.toContain('fixture-plugin')
    expect(listQuarantinedProfilePlugins(home)).toEqual([
      expect.objectContaining({
        profile: 'web',
        packageName: 'fixture-plugin',
        packageSpec: '^2.3.0',
        installedVersion: '2.3.4',
        bundleIndex: 1,
        quarantinedAt: '2026-08-19T01:02:03.000Z',
        reason: 'incompatible-host-dependency',
      }),
    ])
  })

  it('does not invoke pnpm for a healthy profile', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    stageProfile(home, { peerDependencies: { '@deepseek-ai/dsh-tools': '^0.1.0-rc.6' } })
    let installs = 0
    const result = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: () => {
        installs += 1
        return { exitCode: 0 }
      },
    })
    expect(result.status).toBe('healthy')
    expect(installs).toBe(0)
  })

  it('quarantines a compatible plugin when lossless convergence fails', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {
      dependencies: { '@deepseek-ai/dsh-tools': '^0.1.0-rc.6' },
    })
    stageDuplicate(pluginDir, '@deepseek-ai/dsh-tools')

    let installs = 0
    const result = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: () => {
        installs += 1
        if (installs === 1) return { exitCode: 1, diagnostic: 'override install failed' }
        rmSync(pluginDir, { recursive: true, force: true })
        return { exitCode: 0 }
      },
    })

    expect(result).toMatchObject({ status: 'quarantined', diagnostic: 'override install failed' })
    expect(installs).toBe(2)
    expect(readProfileManifest('test', profileDir).dependencies?.['fixture-plugin']).toBeUndefined()
    expect(listQuarantinedProfilePlugins(home)).toEqual([
      expect.objectContaining({ packageName: 'fixture-plugin', reason: 'convergence-failed' }),
    ])
  })

  it('restores a quarantined plugin at its original bundle position and repairs it before activation', () => {
    const { anchor, packageDirs } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {
      dependencies: { '@deepseek-ai/dsh-tools': '^9.0.0' },
    })
    stageDuplicate(pluginDir, '@deepseek-ai/dsh-tools', '9.0.0')
    const quarantined = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: () => {
        if (readProfileManifest('test', profileDir).dependencies?.['fixture-plugin'] === undefined) {
          rmSync(pluginDir, { recursive: true, force: true })
        }
        return { exitCode: 0 }
      },
    }).quarantined[0]!

    let installs = 0
    const result = retryQuarantinedProfilePlugin({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: () => {
        installs += 1
        if (installs === 1) {
          writeManifest(join(pluginDir, 'package.json'), {
            name: 'fixture-plugin',
            version: '2.3.4',
            dependencies: { '@deepseek-ai/dsh-tools': '^0.1.0-rc.6' },
          })
          stageDuplicate(pluginDir, '@deepseek-ai/dsh-tools')
        } else {
          rmSync(join(pluginDir, 'node_modules', '@deepseek-ai/dsh-tools'), { recursive: true, force: true })
          symlinkSync(
            packageDirs.get('@deepseek-ai/dsh-tools')!,
            join(pluginDir, 'node_modules', '@deepseek-ai/dsh-tools'),
            'junction',
          )
        }
        return { exitCode: 0 }
      },
    }, quarantined.quarantineId)

    expect(result.status).toBe('repaired')
    expect(installs).toBe(2)
    expect(readProfileManifest('test', profileDir).dependencies?.['fixture-plugin']).toBe('^2.3.0')
    expect(readProfileManifest('test', profileDir).dsh?.profile?.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      'fixture-plugin',
    ])
    expect(listQuarantinedProfilePlugins(home)).toEqual([])
  })

  it('rolls a failed quarantine retry back to the clean inactive profile', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {
      dependencies: { '@deepseek-ai/dsh-tools': '^9.0.0' },
    })
    stageDuplicate(pluginDir, '@deepseek-ai/dsh-tools', '9.0.0')
    const quarantined = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: () => {
        if (readProfileManifest('test', profileDir).dependencies?.['fixture-plugin'] === undefined) {
          rmSync(pluginDir, { recursive: true, force: true })
        }
        return { exitCode: 0 }
      },
    }).quarantined[0]!

    let installs = 0
    const result = retryQuarantinedProfilePlugin({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: () => {
        installs += 1
        return installs === 1 ? { exitCode: 1, diagnostic: 'registry unavailable' } : { exitCode: 0 }
      },
    }, quarantined.quarantineId)

    expect(result).toMatchObject({ status: 'failed', diagnostic: 'registry unavailable' })
    expect(installs).toBe(2)
    expect(readProfileManifest('test', profileDir).dependencies?.['fixture-plugin']).toBeUndefined()
    expect(readProfileManifest('test', profileDir).dsh?.profile?.bundles).not.toContain('fixture-plugin')
    expect(listQuarantinedProfilePlugins(home)).toEqual([expect.objectContaining({
      quarantineId: quarantined.quarantineId,
    })])
  })

  it('uninstalls an inactive quarantined plugin before clearing its record', () => {
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {})
    const manifest = readProfileManifest('test', profileDir)
    writeProfileManifest(profileDir, {
      ...manifest,
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    })
    const quarantined = stageQuarantineRecord(home)

    expect(existsSync(pluginDir)).toBe(true)
    expect(readProfileManifest('test', profileDir).dependencies?.['fixture-plugin']).toBeUndefined()
    expect(uninstallQuarantinedProfilePlugin(quarantined.quarantineId, home)).toBe(true)
    expect(existsSync(pluginDir)).toBe(false)
    expect(listQuarantinedProfilePlugins(home)).toEqual([])
    expect(uninstallQuarantinedProfilePlugin(quarantined.quarantineId, home)).toBe(false)
  })

  it('refuses to uninstall a quarantined plugin restored to the active profile', () => {
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {})
    const quarantined = stageQuarantineRecord(home)
    writeProfileManifest(profileDir, {
      name: 'dsh-profile-web',
      dependencies: { 'fixture-plugin': '^2.3.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'fixture-plugin'] } },
    })

    expect(() => uninstallQuarantinedProfilePlugin(quarantined.quarantineId, home))
      .toThrow(/cannot uninstall active quarantined plugin/)
    expect(existsSync(pluginDir)).toBe(true)
    expect(listQuarantinedProfilePlugins(home)).toEqual([expect.objectContaining({
      quarantineId: quarantined.quarantineId,
    })])
  })
})
