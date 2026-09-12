// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import {
  PluginDiagnosticsSection,
  type PluginDiagnosticsSectionProps,
} from '../src/client/PluginDiagnosticsSection.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: PluginInventoryLocaleKey): string => en[key]) as PluginDiagnosticsSectionProps['t']

function props(snapshot: PluginInventorySnapshot): PluginDiagnosticsSectionProps {
  const unexpected = async (): Promise<never> => { throw new Error('unexpected mutation') }
  return {
    t,
    list: async () => snapshot,
    startDependencyDoctor: unexpected,
    getDependencyDoctor: unexpected,
    getInstall: unexpected,
    startUninstall: unexpected,
    startQuarantineRetry: unexpected,
    approveQuarantineBuild: unexpected,
    approveDiagnosticBuild: unexpected,
    exportDiagnostics: async () => '{}',
    uninstallQuarantine: async () => true,
    dismissDependencyHealth: async () => true,
    openPluginMarket: vi.fn(),
  } as unknown as PluginDiagnosticsSectionProps
}

describe('PluginDiagnosticsSection', () => {
  it('explains a legacy Session API warning without claiming the plugin was quarantined', async () => {
    render(<PluginDiagnosticsSection {...props({
      entries: [],
      dependencyHealth: {
        lastRepair: null, safeMode: null, quarantined: [],
        issues: [{
          diagnosticId: '00000000-0000-4000-8000-000000000016',
          code: 'profile.session-api-incompatible', source: 'profile', phase: 'preflight', severity: 'warning',
          attribution: { rootPackage: '@fixture/legacy-session' }, actions: ['open-config', 'export'], evidence: [],
        }],
      },
    } as unknown as PluginInventorySnapshot)} />)
    expect(await screen.findByText(en['diagnostics.issue.sessionApi'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: en['health.quarantine.action.findUpdate'] })).toBeNull()
  })

  it('explains a frozen agent-input mutation and names its attributed plugin', async () => {
    render(<PluginDiagnosticsSection {...props({
      entries: [],
      dependencyHealth: {
        lastRepair: null, safeMode: null, quarantined: [],
        issues: [{
          diagnosticId: '00000000-0000-4000-8000-000000000017',
          code: 'profile.immutable-agent-input-mutation', source: 'profile', phase: 'preflight', severity: 'warning',
          attribution: { rootPackage: '@fixture/frozen-input' }, actions: ['isolate', 'export'], evidence: [],
        }],
      },
    } as unknown as PluginInventorySnapshot)} />)
    expect(await screen.findByText(en['diagnostics.issue.immutableAgentInput'])).toBeTruthy()
    expect(screen.getByText('@fixture/frozen-input')).toBeTruthy()
  })

  it('shows declared Harness compatibility before offering a market update', async () => {
    render(<PluginDiagnosticsSection {...props({
      entries: [],
      dependencyHealth: {
        lastRepair: null,
        safeMode: null,
        quarantined: [{
          quarantineId: '00000000-0000-4000-8000-000000000012',
          profile: 'web',
          packageName: '@fixture/compatibility-plugin',
          packageSpec: '1.0.0',
          installedVersion: '1.0.0',
          quarantinedAt: '2026-09-07T12:00:00.000Z',
          reason: 'incompatible-host-version',
          hostCompatibility: {
            hostVersion: '0.1.2-rc.1',
            supportedHostVersions: ['0.1.2-alpha.5'],
            recommendedHostVersion: '0.1.2-alpha.5',
            previewTag: 'next',
          },
          conflicts: [],
        }],
        issues: [],
      },
    } as unknown as PluginInventorySnapshot)} />)

    expect(await screen.findAllByText('0.1.2-rc.1')).toHaveLength(2)
    expect(screen.getAllByText('0.1.2-alpha.5').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText(en['health.quarantine.solution.incompatible-host-version'])).toHaveLength(2)
    expect(screen.getByRole('button', { name: en['health.quarantine.action.findUpdate'] })).toBeTruthy()
  })

  it('shows the missing dependency export and compatible-version recovery actions', async () => {
    const packageName = 'dsh-webchat'
    const missingExport = 'installSettingsSection'
    render(<PluginDiagnosticsSection {...props({
      entries: [],
      dependencyHealth: {
        lastRepair: null,
        safeMode: null,
        quarantined: [{
          quarantineId: '00000000-0000-4000-8000-000000000014',
          profile: 'web',
          packageName,
          packageSpec: '0.2.0',
          installedVersion: '0.2.0',
          quarantinedAt: '2026-09-05T12:00:00.000Z',
          reason: 'loader-dependency-unavailable',
          conflicts: [],
        }],
        issues: [{
          diagnosticId: '00000000-0000-4000-8000-000000000015',
          code: 'loader.dependency-unavailable',
          source: 'loader',
          phase: 'import',
          severity: 'blocked',
          attribution: {
            rootPackage: packageName,
            entryId: 'webchat',
            moduleName: packageName,
            importerPackage: packageName,
            missingModule: '@deepseek-ai/dsh-settings',
            missingExport,
          },
          actions: ['restore', 'export'],
          evidence: [],
        }],
      },
    } as unknown as PluginInventorySnapshot)} />)

    expect(await screen.findByText(`Dependency does not export the API required by the plugin: ${missingExport}`))
      .toBeTruthy()
    expect(screen.getAllByText(en['health.quarantine.solution.loader-dependency-unavailable'])).toHaveLength(2)
    expect(screen.getByRole('button', { name: en['health.quarantine.action.findUpdate'] })).toBeTruthy()
    expect(screen.getByRole('button', { name: en['health.uninstall'] })).toBeTruthy()
  })

  it('explains a plugin collision with a built-in Loader entry', async () => {
    const packageName = 'dsh-file-upload'
    render(<PluginDiagnosticsSection {...props({
      entries: [],
      dependencyHealth: {
        lastRepair: null,
        safeMode: null,
        quarantined: [{
          quarantineId: '00000000-0000-4000-8000-000000000018',
          profile: 'web',
          packageName,
          packageSpec: '^0.4.3',
          installedVersion: '0.4.3',
          quarantinedAt: '2026-09-12T02:00:00.000Z',
          reason: 'loader-entry-collision',
          conflicts: [],
        }],
        issues: [{
          diagnosticId: '00000000-0000-4000-8000-000000000019',
          code: 'loader.duplicate-entry',
          source: 'loader',
          phase: 'apply',
          severity: 'blocked',
          attribution: { rootPackage: packageName, entryId: 'file-upload', moduleName: packageName },
          actions: ['repair', 'isolate', 'open-config', 'export'],
          evidence: [],
        }],
      },
    })} />)

    expect(await screen.findAllByText(en['health.quarantine.reason.loaderEntryCollision'])).toHaveLength(1)
    expect(screen.getAllByText(en['health.quarantine.solution.loader-entry-collision'])).toHaveLength(2)
    expect(screen.getByRole('button', { name: en['health.quarantine.action.findUpdate'] })).toBeTruthy()
  })
})
