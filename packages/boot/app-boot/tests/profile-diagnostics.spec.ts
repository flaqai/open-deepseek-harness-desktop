import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyProfileDiagnostic,
  clearProfileDiagnosticReport,
  createProfileDiagnosticReport,
  extractProfileBuildApprovalKey,
  profileDiagnosticRuleCatalog,
  quarantineRemovalResidueDiagnostic,
  readProfileDiagnosticReport,
  sanitizeProfileDiagnostic,
  writeProfileDiagnosticReport,
  type ProfileDiagnosticCode,
} from '../src/profile-diagnostics.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('profile diagnostic v2', () => {
  it.each<[string, ProfileDiagnosticCode, string]>([
    ['ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED allowBuilds', 'pnpm.build-script-blocked', 'security'],
    ['ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION', 'pnpm.minimum-release-age', 'security'],
    ['ERR_PNPM_UNEXPECTED_STORE unexpected store location', 'pnpm.unexpected-store', 'blocked'],
    ['ECONNRESET while fetching registry', 'pnpm.network', 'warning'],
    ['ERR_PNPM_FETCH_401 registry unauthorized', 'pnpm.registry-auth', 'blocked'],
    ['ERR_PNPM_OUTDATED_LOCKFILE', 'pnpm.lockfile', 'blocked'],
    ['ERR_PNPM_TARBALL_INTEGRITY', 'pnpm.integrity', 'security'],
    ['ERR_PNPM_NO_MATCHING_VERSION', 'pnpm.version-resolution', 'blocked'],
    ['ERR_PNPM_UNSUPPORTED_ENGINE', 'pnpm.runtime-version', 'blocked'],
    ['ERR_PNPM_PEER_DEP_ISSUES', 'pnpm.peer-dependency', 'blocked'],
    ['ERR_PNPM_TRUST_DOWNGRADE', 'pnpm.supply-chain', 'security'],
    ['ERR_PNPM_INVALID_DEPENDENCY_NAME', 'pnpm.invalid-dependency', 'blocked'],
    ['ERR_PNPM_YAML_PARSE pnpm-workspace.yaml', 'pnpm.config-parse', 'blocked'],
    ['ERR_PNPM_PATCH_FAILED', 'pnpm.patch-failed', 'blocked'],
    ['credentials-local: the value for "version" must be a string', 'config.credentials-invalid', 'blocked'],
    ['settings-file: invalid document at C:\\Users\\Alice\\settings.yaml: DUPLICATE_KEY at line 9, column 3', 'config.settings-invalid', 'blocked'],
    ["Cannot find package '@deepseek-ai/dsh-session-persistence-sqlite' imported from cordis.patch.yml", 'profile.session-persistence-migration', 'blocked'],
    ['corrupt Zstandard session log: first frame is not exactly one header line', 'session.persistence-corrupt', 'blocked'],
    ['loader dependency unavailable: Loader module @fixture/ui imports unavailable dependency @deepseek-ai/dsh-host-apiproxy', 'loader.dependency-unavailable', 'blocked'],
    ['loader dependency unavailable: Loader module dsh-webchat expects export installSettingsSection from @deepseek-ai/dsh-settings, but the installed dependency does not provide it', 'loader.dependency-unavailable', 'blocked'],
    ['duplicate loader entry web-panel', 'loader.duplicate-entry', 'blocked'],
    ['persona already registered', 'loader.duplicate-registration', 'blocked'],
    ['pending (waiting for services: files)', 'loader.unresolved-injection', 'blocked'],
    ['rollback failed while removing loader entry', 'loader.rollback-failed', 'blocked'],
    ['Harness exited before becoming ready', 'runtime.launch-invalid', 'blocked'],
  ])('classifies %s', (message, code, severity) => {
    const issue = classifyProfileDiagnostic({ source: 'pnpm', phase: 'install', value: message })
    expect(issue).toMatchObject({ code, severity })
  })

  it('preserves the cause chain and attributes the innermost Loader entry', () => {
    const cause = new TypeError('credentials-local: the value for "version" must be a string')
    const error = new Error('failed to apply loader entry credentials (@deepseek-ai/dsh-credentials-local)', { cause })
    const issue = classifyProfileDiagnostic({ source: 'loader', phase: 'apply', value: error })
    expect(issue.code).toBe('config.credentials-invalid')
    expect(issue.attribution).toEqual({
      entryId: 'credentials',
      moduleName: '@deepseek-ai/dsh-credentials-local',
    })
    expect(issue.evidence).toHaveLength(2)
    expect(issue.evidence[1]).toContain('value for "version"')
  })

  it('attributes a missing client module supplier to the importing Loader entry', () => {
    const issue = classifyProfileDiagnostic({
      source: 'profile',
      phase: 'import',
      value: 'failed to import loader entry 71626ed6 (dsh-font): client-modules: require("@deepseek-ai/dsh-client-runtime/client") missed the module table — not a platform seed word, not a materialized module, and no registered package factory',
    })
    expect(issue).toMatchObject({
      code: 'profile.module-resolution',
      source: 'profile',
      phase: 'import',
      attribution: {
        entryId: '71626ed6',
        moduleName: 'dsh-font',
      },
      actions: ['repair', 'isolate', 'export'],
    })
  })

  it('offers configuration migration without isolating an old SQLite persistence profile', () => {
    const issue = classifyProfileDiagnostic({
      source: 'loader',
      phase: 'import',
      value: 'failed to import loader entry session-storage (@deepseek-ai/dsh-session-persistence-sqlite): ERR_MODULE_NOT_FOUND',
      attribution: { configKind: 'profile-patch' },
    })
    expect(issue).toMatchObject({
      code: 'profile.session-persistence-migration',
      source: 'profile',
      severity: 'blocked',
      actions: ['open-config', 'export'],
      attribution: {
        entryId: 'session-storage',
        moduleName: '@deepseek-ai/dsh-session-persistence-sqlite',
        configKind: 'profile-patch',
      },
    })
    expect(issue.actions).not.toContain('isolate')
  })

  it('does not misattribute a corrupt Session artifact to a plugin lifecycle failure', () => {
    const error = new Error('plugin tree failed to load', {
      cause: new Error('corrupt Zstandard session log: first frame is not exactly one header line'),
    })
    const issue = classifyProfileDiagnostic({ source: 'profile', phase: 'apply', value: error })
    expect(issue).toMatchObject({
      code: 'session.persistence-corrupt',
      source: 'session',
      actions: ['export'],
    })
    expect(issue.actions).not.toContain('isolate')
  })

  it('does not attribute a nested import failure to the outer include row', () => {
    const inner = new Error('failed to import loader entry scoped-mismatch (missing-unscoped-module)', {
      cause: new Error("Cannot find package 'missing-unscoped-module'"),
    })
    const outer = new Error('failed to import loader entry include (cordis:include)', { cause: inner })
    expect(classifyProfileDiagnostic({ source: 'loader', phase: 'import', value: outer }).attribution).toEqual({
      entryId: 'scoped-mismatch',
      moduleName: 'missing-unscoped-module',
    })
  })

  it('describes stale quarantine removal state as a repair-only warning', () => {
    expect(quarantineRemovalResidueDiagnostic('dsh-font', [
      'repair-report',
      'lockfile-importer',
    ])).toMatchObject({
      code: 'profile.quarantine-removal-residue',
      source: 'profile',
      phase: 'preflight',
      severity: 'warning',
      attribution: { rootPackage: 'dsh-font' },
      actions: ['repair', 'export'],
      evidence: ['repair-report', 'lockfile-importer'],
    })
    expect(profileDiagnosticRuleCatalog()).toContainEqual({
      code: 'profile.quarantine-removal-residue',
      severity: 'warning',
      actions: ['repair', 'export'],
      nativeCodes: [],
    })
  })

  it('redacts credentials and user paths while retaining an exact reviewed build key', () => {
    const home = '/Users/alice/Library/Application Support/dsh'
    const raw = [
      `token: plain-secret at ${home}/profiles/web`,
      'DEEPSEEK_API_KEY=sk-1234567890abcdef',
      'C:\\Users\\Alice\\.dsh\\profiles\\web',
      'dsh: pnpm allowBuilds key "fixture@git+https://example.invalid/repo.git#commit"',
    ].join('\n')
    const sanitized = sanitizeProfileDiagnostic(raw, home)
    expect(sanitized).not.toContain('plain-secret')
    expect(sanitized).not.toContain('sk-1234567890abcdef')
    expect(sanitized).not.toContain('/Users/alice')
    expect(sanitized).not.toContain('C:\\Users\\Alice')
    expect(extractProfileBuildApprovalKey(sanitized))
      .toBe('fixture@git+https://example.invalid/repo.git#commit')
  })

  it('persists and clears diagnostic-mode availability with the v2 schema', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-profile-diagnostics-'))
    roots.push(home)
    const issue = classifyProfileDiagnostic({
      source: 'profile',
      phase: 'compose',
      value: 'plugin(s) failed to load: @fixture/broken',
    })
    const report = createProfileDiagnosticReport('web', [issue], {
      now: () => new Date('2026-08-25T00:00:00.000Z'),
      diagnosticMode: {
        enteredAt: '2026-08-25T00:00:01.000Z',
        skippedBundles: ['@fixture/broken'],
        skippedUserLayers: true,
      },
    })
    writeProfileDiagnosticReport(report, home)
    expect(report.status).toBe('diagnostic-mode')
    expect(report).not.toHaveProperty('safeMode')
    expect(readProfileDiagnosticReport('web', home)).toEqual(report)
    expect(clearProfileDiagnosticReport('web', home)).toBe(true)
    expect(readProfileDiagnosticReport('web', home)).toBeUndefined()
  })

  it('retains unknown native evidence without inventing a repair action', () => {
    const issue = classifyProfileDiagnostic({
      source: 'cordis-runtime',
      phase: 'runtime',
      value: 'fixture subsystem failed in a new way',
    })
    expect(issue).toMatchObject({ code: 'profile.unknown', actions: ['export'] })
  })
})
