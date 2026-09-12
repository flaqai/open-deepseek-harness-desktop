import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
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
  inspectProfileHostCompatibility,
  inspectProfileLoaderEntryCollisions,
  inspectOrphanedProfileBundles,
  inspectProfileBundleEntryOwnership,
  inspectUnresolvableProfileBundleEntries,
  listQuarantinedProfilePlugins,
  inspectQuarantineRemovalResidue,
  quarantineProfilePluginAfterLoadFailure,
  reconcileRestoredQuarantinedProfilePlugins,
  readLastProfileRepairReport,
  readProfileDiagnosticReport,
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

function stageHarness(appVersion = '1.0.0'): { anchor: string; packageDirs: Map<string, string> } {
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
  writeManifest(anchor, { name: 'dsh-test-app', version: appVersion, dependencies })
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

describe('profile plugin Host compatibility inspection', () => {
  it('reports only a valid declaration that excludes the running Harness version', () => {
    const { anchor } = stageHarness('0.1.2-rc.1')
    const home = temporaryDirectory('dsh-health-home-')
    const { pluginDir } = stageProfile(home, {})
    writeManifest(join(pluginDir, 'compatibility.json'), {
      schemaVersion: 1,
      recommendedHost: '0.1.2-alpha.5',
      previewTag: 'next',
      supportedHosts: [
        { version: '0.1.2-alpha.5', track: 'recommended' },
        { version: '0.1.2-alpha.2', track: 'legacy' },
      ],
    })

    expect(inspectProfileHostCompatibility({
      binName: 'test', profile: 'web', installAnchor: anchor, home,
    })).toEqual([{
      profile: 'web',
      packageName: 'fixture-plugin',
      installedVersion: '2.3.4',
      hostVersion: '0.1.2-rc.1',
      supportedHostVersions: ['0.1.2-alpha.5', '0.1.2-alpha.2'],
      recommendedHostVersion: '0.1.2-alpha.5',
      previewTag: 'next',
    }])
  })

  it('allows a declared supported Host and treats missing or malformed declarations as unknown', () => {
    const { anchor } = stageHarness('0.1.2-rc.1')
    const home = temporaryDirectory('dsh-health-home-')
    const { pluginDir } = stageProfile(home, {})
    const options = { binName: 'test', profile: 'web', installAnchor: anchor, home }

    expect(inspectProfileHostCompatibility(options)).toEqual([])
    writeManifest(join(pluginDir, 'compatibility.json'), {
      schemaVersion: 1,
      supportedHosts: [{ version: '0.1.2-rc.1', track: 'recommended' }],
    })
    expect(inspectProfileHostCompatibility(options)).toEqual([])
    writeFileSync(join(pluginDir, 'compatibility.json'), '{ invalid json')
    expect(inspectProfileHostCompatibility(options)).toEqual([])
    writeManifest(join(pluginDir, 'compatibility.json'), {
      schemaVersion: 2,
      supportedHosts: [{ version: '0.1.2-alpha.5' }],
    })
    expect(inspectProfileHostCompatibility(options)).toEqual([])
    writeFileSync(join(pluginDir, 'compatibility.json'), ' '.repeat(64 * 1024 + 1))
    expect(inspectProfileHostCompatibility(options)).toEqual([])
  })

  it('quarantines an explicitly incompatible plugin before its code can load', () => {
    const { anchor } = stageHarness('0.1.2-rc.1')
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {})
    writeManifest(join(pluginDir, 'compatibility.json'), {
      schemaVersion: 1,
      recommendedHost: '0.1.2-alpha.5',
      supportedHosts: [{ version: '0.1.2-alpha.5', track: 'recommended' }],
    })

    const result = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      now: () => new Date('2026-09-07T01:02:03.000Z'),
      runPackageManager: () => {
        if (readProfileManifest('test', profileDir).dependencies?.['fixture-plugin'] === undefined) {
          rmSync(pluginDir, { recursive: true, force: true })
        }
        return { exitCode: 0 }
      },
    })

    expect(result).toMatchObject({
      status: 'quarantined',
      hostCompatibilityIssues: [{
        packageName: 'fixture-plugin',
        hostVersion: '0.1.2-rc.1',
        supportedHostVersions: ['0.1.2-alpha.5'],
      }],
      quarantined: [{
        packageName: 'fixture-plugin',
        reason: 'incompatible-host-version',
        hostCompatibility: {
          hostVersion: '0.1.2-rc.1',
          supportedHostVersions: ['0.1.2-alpha.5'],
          recommendedHostVersion: '0.1.2-alpha.5',
        },
      }],
      issues: [{
        code: 'profile.host-version-incompatible',
        phase: 'preflight',
        attribution: {
          rootPackage: 'fixture-plugin',
          hostVersion: '0.1.2-rc.1',
          supportedHostVersions: ['0.1.2-alpha.5'],
        },
      }],
    })
    expect(readProfileManifest('test', profileDir).dependencies?.['fixture-plugin']).toBeUndefined()
    expect(readProfileManifest('test', profileDir).dsh?.profile?.bundles).not.toContain('fixture-plugin')
  })
})

describe('profile composition inspection', () => {
  it('attributes and quarantines an external Bundle that reuses a shipped Loader entry id', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const profileDir = resolveProfileDir('web', home)
    initProfile(profileDir, [])
    const shippedPackage = '@deepseek-ai/dsh-web-app'
    const shippedDir = join(dirname(anchor), 'node_modules', shippedPackage)
    writeManifest(join(shippedDir, 'package.json'), {
      name: shippedPackage,
      version: '1.0.0',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    writeFileSync(join(shippedDir, 'cordis.patch.yml'), [
      '- insert:',
      '  - id: file-upload',
      "    name: '@deepseek-ai/dsh-client-file-upload'",
      '',
    ].join('\n'))
    const pluginName = 'dsh-file-upload'
    const pluginDir = join(profileDir, 'node_modules', pluginName)
    writeManifest(join(pluginDir, 'package.json'), {
      name: pluginName,
      version: '0.4.3',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    writeFileSync(join(pluginDir, 'cordis.patch.yml'), [
      '- insert:',
      '  - id: file-upload',
      `    name: '${pluginName}'`,
      '',
    ].join('\n'))
    writeProfileManifest(profileDir, {
      name: 'dsh-profile-web',
      dependencies: { [pluginName]: '^0.4.3' },
      dsh: { profile: { bundles: [shippedPackage, pluginName] } },
    })

    expect(inspectProfileLoaderEntryCollisions({
      binName: 'test', profile: 'web', installAnchor: anchor, home,
    })).toEqual([expect.objectContaining({
      rootPackage: pluginName,
      entryId: 'file-upload',
      moduleName: pluginName,
      installationPackage: shippedPackage,
      installationModuleName: '@deepseek-ai/dsh-client-file-upload',
    })])

    const result = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: () => {
        if (readProfileManifest('test', profileDir).dependencies?.[pluginName] === undefined) {
          rmSync(pluginDir, { recursive: true, force: true })
        }
        return { exitCode: 0 }
      },
    })

    expect(result).toMatchObject({
      status: 'quarantined',
      quarantined: [{ packageName: pluginName, reason: 'loader-entry-collision' }],
      issues: [{
        code: 'loader.duplicate-entry',
        attribution: { rootPackage: pluginName, entryId: 'file-upload', moduleName: pluginName },
      }],
    })
    expect(readProfileManifest('test', profileDir).dependencies?.[pluginName]).toBeUndefined()
    expect(readProfileManifest('test', profileDir).dsh?.profile?.bundles).not.toContain(pluginName)
  })

  it('does not isolate comment text or a dynamic optional import during static preflight', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const profileDir = resolveProfileDir('web', home)
    initProfile(profileDir, [])
    const packageName = 'fixture-optional-ui'
    const pluginDir = join(profileDir, 'node_modules', packageName)
    writeManifest(join(pluginDir, 'package.json'), {
      name: packageName,
      version: '1.0.0',
      exports: './index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    writeFileSync(join(pluginDir, 'index.js'), '// import "fixture-comment-only"\nexport async function optional() { return import("fixture-optional") }\n')
    writeFileSync(join(pluginDir, 'cordis.patch.yml'), `- insert:\n  - id: optional-ui\n    name: ${packageName}\n`)
    writeProfileManifest(profileDir, {
      dependencies: { [packageName]: '1.0.0' },
      dsh: { profile: { bundles: [packageName] } },
    })

    expect(inspectUnresolvableProfileBundleEntries({
      binName: 'test', profile: 'web', installAnchor: anchor, home,
    })).toEqual([])
  })

  it('attributes a Loader static dependency failure to the enabled aggregate bundle', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const profileDir = resolveProfileDir('web', home)
    initProfile(profileDir, [])
    const packageName = '@fixture/web-ui-all'
    const pluginDir = join(profileDir, 'node_modules', packageName)
    writeManifest(join(pluginDir, 'package.json'), {
      name: packageName,
      version: '1.0.0',
      exports: './index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    writeFileSync(join(pluginDir, 'index.js'), 'import "@fixture/definitely-missing-host"\nexport function apply() {}\n')
    writeFileSync(join(pluginDir, 'cordis.patch.yml'), `- insert:\n  - id: aggregate-ui\n    name: '${packageName}'\n`)
    writeProfileManifest(profileDir, {
      name: 'dsh-profile-web',
      dependencies: { [packageName]: '1.0.0' },
      dsh: { profile: { bundles: [packageName] } },
    })
    expect(inspectProfileBundleEntryOwnership(
      { binName: 'test', profile: 'web', installAnchor: anchor, home },
      'aggregate-ui',
      packageName,
    )).toMatchObject({ rootPackage: packageName })

    expect(inspectUnresolvableProfileBundleEntries({
      binName: 'test', profile: 'web', installAnchor: anchor, home,
    })).toEqual([expect.objectContaining({
      rootPackage: packageName,
      entryId: 'aggregate-ui',
      moduleName: packageName,
      missingModule: '@fixture/definitely-missing-host',
      importerPackage: packageName,
      failureKind: 'loader-dependency',
    })])

    const result = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: () => ({ exitCode: 0 }),
    })
    expect(result).toMatchObject({
      status: 'quarantined',
      quarantined: [{ packageName, reason: 'loader-dependency-unavailable' }],
      issues: [{
        code: 'loader.dependency-unavailable',
        attribution: {
          rootPackage: packageName,
          missingModule: '@fixture/definitely-missing-host',
        },
      }],
    })
  })

  it('attributes a scoped bundle whose patch loads a missing unscoped module and quarantines it', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const profileDir = resolveProfileDir('web', home)
    initProfile(profileDir, [])
    const packageName = '@dsh-diagnostic-lab/scoped-loader-mismatch'
    const pluginDir = join(profileDir, 'node_modules', packageName)
    writeManifest(join(pluginDir, 'package.json'), {
      name: packageName,
      version: '1.0.0',
      exports: './index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    writeFileSync(join(pluginDir, 'index.js'), 'export function apply() {}\n')
    writeFileSync(join(pluginDir, 'cordis.patch.yml'), '- insert:\n  - id: diagnostic-scoped-loader-mismatch\n    name: diagnostic-scoped-loader-mismatch\n    config: {}\n')
    writeProfileManifest(profileDir, {
      name: 'dsh-profile-web',
      dependencies: { [packageName]: '1.0.0' },
      dsh: { profile: { bundles: [packageName] } },
    })

    expect(inspectUnresolvableProfileBundleEntries({
      binName: 'test', profile: 'web', installAnchor: anchor, home,
    })).toEqual([expect.objectContaining({
      rootPackage: packageName,
      entryId: 'diagnostic-scoped-loader-mismatch',
      moduleName: 'diagnostic-scoped-loader-mismatch',
      patchPath: join(pluginDir, 'cordis.patch.yml'),
    })])

    const result = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      now: () => new Date('2026-09-01T08:00:00.000Z'),
      runPackageManager: () => {
        if (readProfileManifest('test', profileDir).dependencies?.[packageName] === undefined) {
          rmSync(pluginDir, { recursive: true, force: true })
        }
        return { exitCode: 0 }
      },
    })

    expect(result).toMatchObject({
      status: 'quarantined',
      quarantined: [{ packageName, reason: 'loader-module-unresolvable' }],
      issues: [{
        code: 'profile.module-resolution',
        attribution: {
          rootPackage: packageName,
          entryId: 'diagnostic-scoped-loader-mismatch',
          moduleName: 'diagnostic-scoped-loader-mismatch',
        },
      }],
    })
    expect(readProfileManifest('test', profileDir).dependencies?.[packageName]).toBeUndefined()
  })

  it('does not claim a missing Loader module when the user patch targets its entry', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const profileDir = resolveProfileDir('web', home)
    initProfile(profileDir, [])
    const packageName = '@dsh-diagnostic-lab/scoped-loader-mismatch'
    const pluginDir = join(profileDir, 'node_modules', packageName)
    writeManifest(join(pluginDir, 'package.json'), {
      name: packageName,
      version: '1.0.0',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    writeFileSync(join(pluginDir, 'cordis.patch.yml'), '- insert:\n  - id: diagnostic-entry\n    name: missing-loader-module\n')
    writeFileSync(join(profileDir, 'cordis.patch.yml'), '- id: diagnostic-entry\n  disabled: true\n')
    writeProfileManifest(profileDir, {
      dependencies: { [packageName]: '1.0.0' },
      dsh: { profile: { bundles: [packageName] } },
    })

    expect(inspectUnresolvableProfileBundleEntries({
      binName: 'test', profile: 'web', installAnchor: anchor, home,
    })).toEqual([])
  })

  it('does not quarantine resolvable aliases, Loader directives, relative modules, or ambiguous bundle owners', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const profileDir = resolveProfileDir('web', home)
    initProfile(profileDir, [])
    const bundles = ['fixture-origin-a', 'fixture-origin-b', 'fixture-origin-c']
    for (const packageName of bundles) {
      const packageDir = join(profileDir, 'node_modules', packageName)
      writeManifest(join(packageDir, 'package.json'), {
        name: packageName,
        version: '1.0.0',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      })
    }
    writeFileSync(join(profileDir, 'node_modules', 'fixture-origin-a', 'inside.js'), 'export default {}\n')
    writeFileSync(join(profileDir, 'node_modules', 'fixture-origin-a', 'cordis.patch.yml'), [
      '- insert:',
      '  - id: alias-entry',
      '    name: alias-loader',
      '  - id: relative-entry',
      '    name: ./inside.js',
      '  - id: include-entry',
      '    name: cordis:include',
      '',
    ].join('\n'))
    for (const packageName of bundles.slice(1)) {
      writeFileSync(join(profileDir, 'node_modules', packageName, 'cordis.patch.yml'), '- insert:\n  - id: ambiguous-entry\n    name: missing-ambiguous-loader\n')
    }
    const aliasDir = join(profileDir, 'node_modules', 'alias-loader')
    writeManifest(join(aliasDir, 'package.json'), { name: 'actual-loader', version: '1.0.0', main: './index.js' })
    writeFileSync(join(aliasDir, 'index.js'), 'module.exports = {}\n')
    writeProfileManifest(profileDir, {
      dependencies: Object.fromEntries(bundles.map(packageName => [packageName, '1.0.0'])),
      dsh: { profile: { bundles } },
    })

    expect(inspectUnresolvableProfileBundleEntries({
      binName: 'test', profile: 'web', installAnchor: anchor, home,
    })).toEqual([])
  })

  it('treats an uninstalled official add-on as orphaned instead of an in-box layer', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const profileDir = resolveProfileDir('web', home)
    initProfile(profileDir, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    const packageName = '@deepseek-ai/dsh-subagent-claude-code'
    const packageDir = join(dirname(anchor), 'node_modules', packageName)
    writeManifest(join(packageDir, 'package.json'), {
      name: packageName,
      version: '0.1.1-rc.2',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    writeProfileManifest(profileDir, {
      name: 'dsh-profile-web',
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', packageName] } },
    })

    expect(inspectOrphanedProfileBundles({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
    })).toEqual([
      expect.objectContaining({
        packageName,
        bundleIndex: 2,
        installedVersion: '0.1.1-rc.2',
      }),
    ])
  })

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

  it('never lowers release-age protection while pruning an orphaned plugin', () => {
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
      ['install'],
    ])
    expect(existsSync(pluginDir)).toBe(false)
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

    expect(calls).toEqual([['install']])
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

    expect(result.status).toBe('quarantined')
    expect(result.diagnostic).toContain('removed directly')
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
  it('quarantines an active external bundle after a client module-table import failure', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {})
    const issue = {
      diagnosticId: 'diagnostic-fixture',
      code: 'profile.module-resolution' as const,
      source: 'profile' as const,
      phase: 'import' as const,
      severity: 'blocked' as const,
      attribution: { entryId: '71626ed6', moduleName: 'fixture-plugin', rootPackage: 'fixture-plugin' },
      actions: ['repair', 'isolate', 'export'] as const,
      evidence: ['client module supplier is unavailable'],
    }

    const result = quarantineProfilePluginAfterLoadFailure({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      now: () => new Date('2026-08-28T03:00:00.000Z'),
      runPackageManager: () => {
        rmSync(pluginDir, { recursive: true, force: true })
        return { exitCode: 0 }
      },
    }, 'fixture-plugin', issue)

    expect(result).toMatchObject({
      status: 'quarantined',
      quarantined: [{
        packageName: 'fixture-plugin',
        packageSpec: '^2.3.0',
        bundleIndex: 1,
        reason: 'client-module-unavailable',
      }],
      issues: [{
        code: 'profile.module-resolution',
        attribution: { rootPackage: 'fixture-plugin', entryId: '71626ed6' },
      }],
    })
    expect(readProfileManifest('test', profileDir).dependencies?.['fixture-plugin']).toBeUndefined()
    expect(readProfileManifest('test', profileDir).dsh?.profile?.bundles).not.toContain('fixture-plugin')
    expect(listQuarantinedProfilePlugins(home)).toEqual([
      expect.objectContaining({ packageName: 'fixture-plugin', reason: 'client-module-unavailable' }),
    ])
  })

  it('retains a distinct reason for a proven Loader lifecycle failure', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { pluginDir } = stageProfile(home, {})
    const result = quarantineProfilePluginAfterLoadFailure({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: () => {
        rmSync(pluginDir, { recursive: true, force: true })
        return { exitCode: 0 }
      },
    }, 'fixture-plugin', {
      diagnosticId: 'lifecycle-fixture',
      code: 'loader.lifecycle-failed',
      source: 'loader',
      phase: 'apply',
      severity: 'blocked',
      attribution: { entryId: 'fixture', moduleName: 'fixture-plugin', rootPackage: 'fixture-plugin' },
      actions: ['retry', 'isolate', 'export'],
      evidence: ['failed to apply loader entry fixture (fixture-plugin)'],
    }, 'loader-lifecycle-failed')

    expect(result).toMatchObject({
      status: 'quarantined',
      quarantined: [{ packageName: 'fixture-plugin', reason: 'loader-lifecycle-failed' }],
      issues: [{ code: 'loader.lifecycle-failed' }],
    })
  })

  it('refuses to quarantine a Loader module that is not a direct active Profile bundle', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir } = stageProfile(home, {})
    const before = readFileSync(join(profileDir, 'package.json'), 'utf8')
    let installs = 0

    const result = quarantineProfilePluginAfterLoadFailure({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: () => {
        installs += 1
        return { exitCode: 0 }
      },
    }, 'transitive-client-module', {
      diagnosticId: 'diagnostic-fixture',
      code: 'profile.module-resolution',
      source: 'profile',
      phase: 'import',
      severity: 'blocked',
      attribution: { moduleName: 'transitive-client-module' },
      actions: ['repair', 'isolate', 'export'],
      evidence: [],
    })

    expect(result.status).toBe('failed')
    expect(result.diagnostic).toContain('not a direct active Profile bundle')
    expect(installs).toBe(0)
    expect(readFileSync(join(profileDir, 'package.json'), 'utf8')).toBe(before)
    expect(listQuarantinedProfilePlugins(home)).toEqual([])
  })

  it('relinks undeclared Host residue to the running installation without invoking pnpm', () => {
    const { anchor, packageDirs } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir } = stageProfile(home, {})
    const staleHost = join(temporaryDirectory('dsh-health-stale-host-'), 'dsh-system-prompt')
    writeManifest(join(staleHost, 'package.json'), {
      name: '@deepseek-ai/dsh-system-prompt',
      version: '0.1.0-rc.7',
    })
    const profileCopy = join(profileDir, 'node_modules', '@deepseek-ai/dsh-system-prompt')
    mkdirSync(dirname(profileCopy), { recursive: true })
    symlinkSync(staleHost, profileCopy, 'junction')
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
      diagnostic: 'relinked unmanaged Host packages: @deepseek-ai/dsh-system-prompt',
    })
    expect(installs).toBe(0)
    expect(realpathSync.native(profileCopy))
      .toBe(realpathSync.native(packageDirs.get('@deepseek-ai/dsh-system-prompt')!))
    expect(readlinkSync(profileCopy)).not.toContain('dsh-health-stale-host-')
  })

  it('repairs a custom profile without a pnpm workspace file without installing packages', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const profileDir = resolveProfileDir('custom', home)
    writeManifest(join(profileDir, 'package.json'), {
      name: 'dsh-profile-custom',
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    })
    const options = {
      binName: 'test', profile: 'custom', installAnchor: anchor, home,
      runPackageManager: () => { throw new Error('healthy profiles must not install packages') },
    }

    expect(repairProfileDependencies(options).status).toBe('healthy')
    const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
    expect(readFileSync(workspacePath, 'utf8')).toBe('dedupePeerDependents: false\n')
    expect(repairProfileDependencies(options).status).toBe('healthy')
    expect(readFileSync(workspacePath, 'utf8')).toBe('dedupePeerDependents: false\n')
  })

  it('preserves workspace comments, build denials and unrelated settings during compatibility repair', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir } = stageProfile(home, {})
    const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
    const source = '# user policy\nallowBuilds:\n  fixture-plugin: false\nminimumReleaseAge: 1440\n'
    writeFileSync(workspacePath, source)
    const options = {
      binName: 'test', profile: 'web', installAnchor: anchor, home,
      runPackageManager: () => { throw new Error('healthy profiles must not install packages') },
    }

    repairProfileDependencies(options)
    const updated = readFileSync(workspacePath, 'utf8')
    expect(updated).toBe(`${source}dedupePeerDependents: false\n`)
    repairProfileDependencies(options)
    expect(readFileSync(workspacePath, 'utf8')).toBe(updated)
  })

  it('does not replace a malformed or unreadable pnpm workspace file', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir } = stageProfile(home, {})
    const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
    const source = 'allowBuilds: [\n'
    writeFileSync(workspacePath, source)
    const options = {
      binName: 'test', profile: 'web', installAnchor: anchor, home,
      runPackageManager: () => { throw new Error('invalid settings must stop repair before installation') },
    }

    expect(() => repairProfileDependencies(options)).toThrow(`cannot update ${workspacePath}`)
    expect(readFileSync(workspacePath, 'utf8')).toBe(source)
    rmSync(workspacePath)
    mkdirSync(workspacePath)
    expect(() => repairProfileDependencies(options)).toThrow()
    expect(existsSync(workspacePath)).toBe(true)
  })

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

  it('quarantines the namespaced Diagnostics Lab fixture without a Profile-wide fake Host override', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const profileDir = resolveProfileDir('web', home)
    initProfile(profileDir, ['@deepseek-ai/dsh-base'])
    const packageName = '@dsh-diagnostic-lab/host-shadow-incompatible'
    const pluginDir = join(profileDir, 'node_modules', packageName)
    writeManifest(join(pluginDir, 'package.json'), {
      name: packageName,
      version: '1.0.0',
      dependencies: { '@deepseek-ai/dsh-tools': '<0.0.0' },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    stageDuplicate(pluginDir, '@deepseek-ai/dsh-tools', '0.0.0-diagnostic')
    writeProfileManifest(profileDir, {
      name: 'dsh-profile-web',
      dependencies: { [packageName]: 'file:../../../diagnostic-fixtures/run/host-shadow-incompatible' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', packageName] } },
    })
    const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
    const beforeWorkspace = readFileSync(workspacePath, 'utf8')

    expect(inspectProfileDependencies({ binName: 'test', profile: 'web', installAnchor: anchor, home }))
      .toEqual([expect.objectContaining({
        rootPackage: packageName,
        dependency: '@deepseek-ai/dsh-tools',
        compatible: false,
      })])

    const result = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: () => {
        if (readProfileManifest('test', profileDir).dependencies?.[packageName] === undefined) {
          rmSync(pluginDir, { recursive: true, force: true })
        }
        return { exitCode: 0 }
      },
    })

    expect(result).toMatchObject({
      status: 'quarantined',
      quarantined: [expect.objectContaining({ packageName, reason: 'incompatible-host-dependency' })],
    })
    expect(inspectProfileDependencies({ binName: 'test', profile: 'web', installAnchor: anchor, home })).toEqual([])
    const workspace = readFileSync(workspacePath, 'utf8')
    expect(workspace).not.toContain('diagnostic-fixtures')
    expect(workspace).not.toContain('nodeLinker: isolated')
    expect(workspace).not.toBe(beforeWorkspace)
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

  it('enters a durable quarantine when pnpm blocks build scripts during cleanup', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {
      dependencies: { '@deepseek-ai/dsh-tools': '^0.1.0-rc.6' },
    })
    stageDuplicate(pluginDir, '@deepseek-ai/dsh-tools')
    const diagnostic = [
      'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED',
      'dsh: pnpm allowBuilds key "fixture-plugin@git+https://example.invalid/fixture-plugin.git"',
    ].join('\n')

    const result = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: () => ({ exitCode: 1, diagnostic }),
    })

    expect(result.status).toBe('quarantined')
    expect(result.diagnostic).toContain('ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED')
    expect(result.quarantined).toEqual([
      expect.objectContaining({ packageName: 'fixture-plugin', reason: 'build-script-blocked' }),
    ])
    expect(existsSync(pluginDir)).toBe(false)
    expect(readProfileManifest('test', profileDir).dependencies?.['fixture-plugin']).toBeUndefined()
    expect(listQuarantinedProfilePlugins(home)).toEqual([
      expect.objectContaining({ packageName: 'fixture-plugin' }),
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
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {})
    const manifest = readProfileManifest('test', profileDir)
    writeProfileManifest(profileDir, {
      ...manifest,
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    })
    const quarantined = stageQuarantineRecord(home)
    const lockfile = stageLockfile(profileDir, ['fixture-plugin'])
    const issue = {
      diagnosticId: '00000000-0000-4000-8000-000000000002',
      code: 'profile.module-resolution' as const,
      source: 'profile' as const,
      phase: 'import' as const,
      severity: 'blocked' as const,
      attribution: { rootPackage: 'fixture-plugin', moduleName: 'fixture-plugin' },
      actions: ['restore', 'export'] as const,
      evidence: ['fixture-plugin missed the module table'],
    }
    writeManifest(join(home, 'profile-health', 'web.json'), {
      schema: 'dsh/profile-dependency-repair/v1',
      diagnosticSchema: 'dsh/profile-diagnostic/v2',
      profile: 'web',
      status: 'quarantined',
      conflicts: [],
      quarantined: [{ ...quarantined, packageName: 'fixture-plugin' }],
      issues: [issue],
    })
    writeManifest(join(home, 'profile-health', 'web.diagnostics.json'), {
      schema: 'dsh/profile-diagnostic/v2',
      profile: 'web',
      generatedAt: '2026-08-30T00:00:00.000Z',
      status: 'issues',
      issues: [issue],
    })

    expect(existsSync(pluginDir)).toBe(true)
    expect(readProfileManifest('test', profileDir).dependencies?.['fixture-plugin']).toBeUndefined()
    expect(uninstallQuarantinedProfilePlugin(quarantined.quarantineId, home)).toBe(true)
    expect(existsSync(pluginDir)).toBe(false)
    expect(readFileSync(lockfile, 'utf8')).not.toContain('fixture-plugin')
    expect(listQuarantinedProfilePlugins(home)).toEqual([])
    expect(readLastProfileRepairReport('web', home)).toBeUndefined()
    expect(readProfileDiagnosticReport('web', home)).toBeUndefined()
    expect(repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: () => { throw new Error('healthy removal must not invoke pnpm') },
    }).status).toBe('healthy')
    expect(uninstallQuarantinedProfilePlugin(quarantined.quarantineId, home)).toBe(false)
  })

  it('preserves unrelated profile incidents when uninstalling a quarantined plugin', () => {
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir } = stageProfile(home, {})
    const manifest = readProfileManifest('test', profileDir)
    writeProfileManifest(profileDir, {
      ...manifest,
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    })
    const quarantined = stageQuarantineRecord(home)
    const removedIssue = {
      diagnosticId: '00000000-0000-4000-8000-000000000002',
      code: 'profile.module-resolution' as const,
      source: 'profile' as const,
      phase: 'import' as const,
      severity: 'blocked' as const,
      attribution: { rootPackage: 'fixture-plugin', moduleName: 'fixture-plugin' },
      actions: ['restore', 'export'] as const,
      evidence: ['fixture-plugin missed the module table'],
    }
    const retainedIssue = {
      diagnosticId: '00000000-0000-4000-8000-000000000003',
      code: 'profile.patch-invalid' as const,
      source: 'profile' as const,
      phase: 'parse' as const,
      severity: 'warning' as const,
      attribution: { rootPackage: 'other-plugin', moduleName: 'other-plugin' },
      actions: ['open-config', 'export'] as const,
      evidence: ['other-plugin has an unrelated configuration warning'],
    }
    writeManifest(join(home, 'profile-health', 'web.json'), {
      schema: 'dsh/profile-dependency-repair/v1',
      diagnosticSchema: 'dsh/profile-diagnostic/v2',
      profile: 'web',
      status: 'quarantined',
      conflicts: [],
      quarantined: [{ ...quarantined, packageName: 'fixture-plugin' }],
      issues: [removedIssue, retainedIssue],
    })
    writeManifest(join(home, 'profile-health', 'web.diagnostics.json'), {
      schema: 'dsh/profile-diagnostic/v2',
      profile: 'web',
      generatedAt: '2026-08-30T00:00:00.000Z',
      status: 'issues',
      issues: [removedIssue, retainedIssue],
    })

    expect(uninstallQuarantinedProfilePlugin(quarantined.quarantineId, home)).toBe(true)
    expect(readLastProfileRepairReport('web', home)).toMatchObject({
      status: 'repaired',
      quarantined: [],
      issues: [{ diagnosticId: retainedIssue.diagnosticId }],
    })
    expect(readProfileDiagnosticReport('web', home)).toMatchObject({
      status: 'issues',
      issues: [{ diagnosticId: retainedIssue.diagnosticId }],
    })
  })

  it('detects and repairs state left by an older quarantine uninstaller', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {})
    const manifest = readProfileManifest('test', profileDir)
    writeProfileManifest(profileDir, {
      ...manifest,
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    })
    rmSync(pluginDir, { recursive: true, force: true })
    const lockfile = stageLockfile(profileDir, ['fixture-plugin'])
    const record = {
      quarantineId: '00000000-0000-4000-8000-000000000001',
      profile: 'web',
      packageName: 'fixture-plugin',
      packageSpec: '^2.3.0',
      installedVersion: '2.3.4',
      bundleIndex: 1,
      quarantinedAt: '2026-08-19T01:02:03.000Z',
      reason: 'client-module-unavailable',
      conflicts: [],
    }
    const issue = {
      diagnosticId: '00000000-0000-4000-8000-000000000002',
      code: 'profile.module-resolution',
      source: 'profile',
      phase: 'repair',
      severity: 'blocked',
      attribution: { rootPackage: 'fixture-plugin' },
      actions: ['restore', 'export'],
      evidence: [],
    }
    writeManifest(join(home, 'profile-health', 'web.json'), {
      schema: 'dsh/profile-dependency-repair/v1',
      diagnosticSchema: 'dsh/profile-diagnostic/v2',
      profile: 'web',
      status: 'quarantined',
      conflicts: [],
      quarantined: [record],
      issues: [issue],
    })
    writeManifest(join(home, 'profile-health', 'web.diagnostics.json'), {
      schema: 'dsh/profile-diagnostic/v2',
      profile: 'web',
      generatedAt: '2026-08-30T00:00:00.000Z',
      status: 'issues',
      issues: [issue],
    })

    expect(inspectQuarantineRemovalResidue({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
    })).toEqual([expect.objectContaining({
      packageName: 'fixture-plugin',
      staleComponents: ['repair-report', 'diagnostic-report', 'lockfile-importer'],
    })])

    const repaired = repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: () => { throw new Error('metadata cleanup must not invoke pnpm') },
    })
    expect(repaired).toMatchObject({ status: 'repaired' })
    expect(repaired.diagnostic).toContain('removed stale quarantine state: fixture-plugin')
    expect(readFileSync(lockfile, 'utf8')).not.toContain('fixture-plugin')
    expect(readProfileDiagnosticReport('web', home)).toBeUndefined()
    expect(inspectQuarantineRemovalResidue({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
    })).toEqual([])
    expect(repairProfileDependencies({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
      runPackageManager: () => { throw new Error('healthy follow-up must not invoke pnpm') },
    }).status).toBe('healthy')
  })

  it('does not treat an ordinary durable quarantine as removal residue', () => {
    const { anchor } = stageHarness()
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {})
    const manifest = readProfileManifest('test', profileDir)
    writeProfileManifest(profileDir, {
      ...manifest,
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    })
    rmSync(pluginDir, { recursive: true, force: true })
    const quarantined = stageQuarantineRecord(home)
    writeManifest(join(home, 'profile-health', 'web.json'), {
      schema: 'dsh/profile-dependency-repair/v1',
      diagnosticSchema: 'dsh/profile-diagnostic/v2',
      profile: 'web',
      status: 'quarantined',
      conflicts: [],
      quarantined: [{ ...quarantined, packageName: 'fixture-plugin' }],
      issues: [],
    })

    expect(inspectQuarantineRemovalResidue({
      binName: 'test',
      profile: 'web',
      installAnchor: anchor,
      home,
    })).toEqual([])
    expect(listQuarantinedProfilePlugins(home)).toHaveLength(1)
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

  it('reconciles stale quarantine metadata after a plugin is fully restored', () => {
    const home = temporaryDirectory('dsh-health-home-')
    const { profileDir, pluginDir } = stageProfile(home, {})
    const quarantined = stageQuarantineRecord(home)
    writeProfileManifest(profileDir, {
      name: 'dsh-profile-web',
      dependencies: { 'fixture-plugin': '^2.3.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'fixture-plugin'] } },
    })
    writeManifest(join(home, 'profile-health', 'web.json'), {
      schema: 'dsh/profile-dependency-repair/v1',
      diagnosticSchema: 'dsh/profile-diagnostic/v2',
      profile: 'web',
      status: 'quarantined',
      conflicts: [],
      quarantined: [quarantined],
      issues: [],
    })

    expect(reconcileRestoredQuarantinedProfilePlugins(
      { binName: 'test', profile: 'web', home },
      new Set(),
    )).toEqual([])
    expect(listQuarantinedProfilePlugins(home)).toHaveLength(1)
    expect(reconcileRestoredQuarantinedProfilePlugins(
      { binName: 'test', profile: 'web', home },
      new Set(['fixture-plugin']),
    )).toEqual(['fixture-plugin'])
    expect(existsSync(pluginDir)).toBe(true)
    expect(readProfileManifest('test', profileDir).dependencies?.['fixture-plugin']).toBe('^2.3.0')
    expect(readProfileManifest('test', profileDir).dsh?.profile?.bundles).toContain('fixture-plugin')
    expect(listQuarantinedProfilePlugins(home)).toEqual([])
    expect(readLastProfileRepairReport('web', home)).toBeUndefined()
  })
})
