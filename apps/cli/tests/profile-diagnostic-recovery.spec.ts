import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  classifyProfileDiagnostic,
  healProfilesModuleFallback,
  loadDiagnosticProfile,
} from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { INSTALL_ANCHOR } from '../src/install-anchor.ts'
import {
  diagnosticProfileModuleBaseUrl,
  isDeterministicSafeModeFailure,
  loaderClientModuleFailure,
  loaderEntryFailure,
} from '../src/profile-boot.ts'

describe('Profile diagnostic recovery policy', () => {
  it('anchors safe-mode imports at the installation-maintained profiles fallback', () => {
    const profileDir = join('/fixture', 'dsh-home', 'profiles', 'web')
    const baseUrl = diagnosticProfileModuleBaseUrl(profileDir)
    expect(new URL(baseUrl).protocol).toBe('file:')
    expect(fileURLToPath(baseUrl)).toBe(join('/fixture', 'dsh-home', 'profiles', 'package.json'))
  })

  it('resolves installation transitive modules from the healed diagnostic fallback', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-safe-mode-modules-'))
    try {
      const profile = loadDiagnosticProfile('test', 'web', INSTALL_ANCHOR, home)
      await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR, profile, home })
      const requireFromFallback = createRequire(fileURLToPath(diagnosticProfileModuleBaseUrl(profile.dir)))
      expect(existsSync(requireFromFallback.resolve('@deepseek-ai/dsh-tools'))).toBe(true)
      expect(existsSync(requireFromFallback.resolve('@deepseek-ai/dsh-typert-registry'))).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('does not divert transient, waiting-period, unknown, or broken-runtime failures into safe mode', () => {
    for (const value of [
      'ECONNRESET while fetching registry',
      'ERR_PNPM_FETCH_401 registry unauthorized',
      'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION',
      'a failure the current rules do not recognize',
      'Harness exited before becoming ready',
    ]) {
      const issue = classifyProfileDiagnostic({ source: 'profile', phase: 'preflight', value })
      expect(isDeterministicSafeModeFailure(issue), issue.code).toBe(false)
    }
  })

  it('enters safe mode for user configuration and external Loader failures', () => {
    for (const value of [
      'credentials-local: the value for "version" must be a string',
      'failed to apply loader entry fixture (@fixture/broken): activation failed',
      'duplicate loader entry fixture',
      'corrupt Zstandard session log: first frame is not exactly one header line',
    ]) {
      const issue = classifyProfileDiagnostic({ source: 'loader', phase: 'apply', value })
      expect(isDeterministicSafeModeFailure(issue), issue.code).toBe(true)
    }
  })

  it('extracts only proven client module-table Loader import failures', () => {
    const cause = new Error('client-modules: require("@deepseek-ai/dsh-client-runtime/client") missed the module table — not a platform seed word, not a materialized module, and no registered package factory')
    const error = new Error('failed to import loader entry 71626ed6 (dsh-font)', { cause })
    expect(loaderClientModuleFailure(error)).toEqual({
      entryId: '71626ed6',
      moduleName: 'dsh-font',
    })
    expect(loaderClientModuleFailure(
      new Error('failed to import loader entry 71626ed6 (dsh-font): plugin apply threw'),
    )).toBeUndefined()
  })

  it('attributes a Loader apply failure independently of plugin-authored text', () => {
    const inner = new Error('failed to apply loader entry whale-widget (dsh-whale-widget): route registration exploded', {
      cause: new Error('untrusted plugin detail'),
    })
    const outer = new Error('failed to apply loader entry include (cordis:include)', { cause: inner })
    expect(loaderEntryFailure(outer)).toEqual({
      stage: 'apply',
      entryId: 'whale-widget',
      moduleName: 'dsh-whale-widget',
    })
    expect(loaderEntryFailure(new Error('plugin claimed dsh-whale-widget failed'))).toBeUndefined()
  })

  it('finds a Loader lifecycle failure nested in an aggregate startup error', () => {
    const failure = new AggregateError([
      new Error('unrelated service cleanup failed'),
      new Error('failed to apply loader entry whale-widget (dsh-whale-widget): controlled failure'),
    ], 'plugin tree failed to load')

    expect(loaderEntryFailure(failure)).toEqual({
      stage: 'apply',
      entryId: 'whale-widget',
      moduleName: 'dsh-whale-widget',
    })
  })

  it('selects the deepest Loader import from a generic module-resolution cause chain', () => {
    const missing = new Error("Cannot find package 'wrong-loader-name' imported from /fixture/cordis.yml")
    const inner = new Error('failed to import loader entry inner-entry (wrong-loader-name)', { cause: missing })
    const outer = new Error('failed to import loader entry outer-entry (cordis:include)', { cause: inner })

    expect(loaderClientModuleFailure(outer)).toEqual({
      entryId: 'inner-entry',
      moduleName: 'wrong-loader-name',
    })
  })

  it('attributes a Loader whose installed dependency lacks the API expected by the plugin', () => {
    const incompatibleApi = new SyntaxError(
      "The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'installSettingsSection'",
    )
    const inner = new Error('failed to import loader entry webchat (dsh-webchat)', { cause: incompatibleApi })
    const outer = new Error('failed to apply loader entry include (cordis:include)', { cause: inner })

    expect(loaderClientModuleFailure(outer)).toEqual({
      entryId: 'webchat',
      moduleName: 'dsh-webchat',
      dependencyModule: '@deepseek-ai/dsh-settings',
      missingExport: 'installSettingsSection',
    })
  })

  it('does not attribute an unowned plugin exception as an incompatible dependency API', () => {
    expect(loaderClientModuleFailure(
      new Error("The requested module '@fixture/api' does not provide an export named 'missing'"),
    )).toBeUndefined()
  })
})
