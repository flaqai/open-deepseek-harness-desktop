// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  PluginEntryId,
  PluginInstallId,
  PluginInstallSnapshot,
} from '@deepseek-ai/dsh-host-plugin-inventory/types'
import {
  ExternalToolsSection,
  type ExternalToolsSectionInjected,
  type ExternalToolsSectionProps,
} from '../src/client/ExternalToolsSection.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: PluginInventoryLocaleKey, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    en[key],
  )) as ExternalToolsSectionProps['t']

function props(overrides: Partial<ExternalToolsSectionInjected> = {}): ExternalToolsSectionProps {
  return {
    t,
    list: async () => ({
      entries: [],
      dependencyHealth: { lastRepair: null, quarantined: [], issues: [], diagnosticMode: null },
    }),
    externalTools: async () => ({ codex: false, claudeCode: false }),
    setExternalTool: async () => ({ codex: false, claudeCode: false }),
    installExternalTool: async () => { throw new Error('unexpected install') },
    getInstall: async () => { throw new Error('unexpected install poll') },
    getInstallOutput: async () => { throw new Error('unexpected output poll') },
    pauseInstall: async () => { throw new Error('unexpected pause') },
    cancelInstall: async () => { throw new Error('unexpected cancel') },
    getWorkspaceRuntimes: async () => ({
      currentHome: '/test/dsh-home', target: 'darwin-arm64',
      capabilities: {
        office: { capabilityId: 'office', phase: 'not-installed' },
        ptc: { capabilityId: 'ptc', phase: 'not-installed' },
      },
    }),
    startWorkspaceRuntime: async () => { throw new Error('unexpected workspace-runtime install') },
    getWorkspaceRuntimeJob: async () => { throw new Error('unexpected workspace-runtime poll') },
    readWorkspaceRuntimeOutput: async () => { throw new Error('unexpected workspace-runtime output poll') },
    pauseWorkspaceRuntime: async () => { throw new Error('unexpected workspace-runtime pause') },
    cancelWorkspaceRuntime: async () => { throw new Error('unexpected workspace-runtime cancel') },
    activateWorkspaceRuntime: async () => { throw new Error('unexpected workspace-runtime activation') },
    removeWorkspaceRuntime: async () => { throw new Error('unexpected workspace-runtime removal') },
    restart: async () => false,
    activateAutoReview: async () => 'no-session',
    ...overrides,
  } as ExternalToolsSectionProps
}

describe('ExternalToolsSection download progress', () => {
  it('renders the workspace-runtime download terminal with the shared localized labels', async () => {
    const startWorkspaceRuntime = vi.fn(async () => ({
      jobId: 'workspace-office-download',
      capabilityId: 'office' as const,
      phase: 'paused' as const,
      stage: 'downloading' as const,
      transferredBytes: 512,
    }))
    render(<ExternalToolsSection {...props({ startWorkspaceRuntime })} />)
    const title = await screen.findByRole('heading', { name: en['external.runtime.office.title'] })
    const card = within(title.closest('li')!)
    fireEvent.click(card.getByRole('button', { name: en['external.runtime.action.install'] }))
    const dialog = await screen.findByRole('dialog', { name: en['external.runtime.progress.title'] })
    expect(startWorkspaceRuntime).toHaveBeenCalledWith('office')
    expect(within(dialog).getByText('downloading')).toBeTruthy()
    expect(within(dialog).getByText(en['external.terminal.noOutput'])).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: en['external.action.resume'] })).toBeTruthy()
  })

  it('places the 0.1.6 experimental capabilities above the aligned external-tools grid', async () => {
    render(<ExternalToolsSection {...props()} />)

    await screen.findByRole('heading', { name: en['external.title'] })
    expect(screen.getByText(en['external.capability.releaseBadge'])).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Browser Use' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Computer Use' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Auto review' })).toBeTruthy()
    const capabilityGrid = screen.getByTestId('experimental-capability-grid')
    const runtimeGrid = screen.getByTestId('workspace-runtime-grid')
    const externalGrid = screen.getByTestId('external-tools-grid')
    expect(screen.getByRole('heading', { name: en['external.runtime.title'] })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en['external.runtime.office.title'] })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en['external.runtime.ptc.title'] })).toBeTruthy()
    expect(screen.getByText(/Quick restart downloads the experimental adapter from npm/u)).toBeTruthy()
    expect(capabilityGrid.compareDocumentPosition(runtimeGrid) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(runtimeGrid.compareDocumentPosition(externalGrid) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(capabilityGrid.compareDocumentPosition(externalGrid) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)

    fireEvent.click(screen.getAllByRole('button', { name: en['external.capability.action.configure'] })[0]!)
    expect(await screen.findByRole('dialog', { name: 'Browser Use' })).toBeTruthy()
    expect(screen.getByLabelText(en['external.capability.browser.backend.playwright'])).toBeTruthy()
    expect(screen.getByLabelText(en['external.capability.browser.mode.launch'])).toBeTruthy()
    expect(screen.getByRole('button', { name: en['external.capability.action.installSelected'] })).toBeTruthy()
  })

  it('explains the selected Browser Use and Computer Use options independently', async () => {
    render(<ExternalToolsSection {...props()} />)

    await screen.findByRole('heading', { name: 'Browser Use' })
    fireEvent.click(screen.getAllByRole('button', { name: en['external.capability.action.configure'] })[0]!)

    expect(screen.getByText(en['external.capability.browser.backend.playwrightNotice'])).toBeTruthy()
    expect(screen.getByText(en['external.capability.browser.mode.launchNotice'])).toBeTruthy()

    fireEvent.click(screen.getByLabelText(en['external.capability.browser.backend.devtools']))
    expect(screen.getByText(en['external.capability.browser.backend.devtoolsNotice'])).toBeTruthy()
    expect(screen.queryByText(en['external.capability.browser.backend.playwrightNotice'])).toBeNull()

    fireEvent.click(screen.getByLabelText(en['external.capability.browser.mode.attach']))
    expect(screen.getByText(en['external.capability.browser.mode.attachNotice'])).toBeTruthy()
    expect(screen.queryByText(en['external.capability.browser.mode.launchNotice'])).toBeNull()

    fireEvent.click(screen.getByLabelText(en['external.capability.browser.backend.stagehand']))
    expect(screen.getByText(en['external.capability.browser.backend.stagehandNotice'])).toBeTruthy()
    expect(screen.getByText(en['external.capability.browser.mode.attachNotice'])).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en['external.capability.dialog.close'] }))
    fireEvent.click(screen.getAllByRole('button', { name: en['external.capability.action.configure'] })[1]!)

    expect(await screen.findByText(en['external.capability.computer.backend.nativeNotice'])).toBeTruthy()
    fireEvent.click(screen.getByLabelText(en['external.capability.computer.backend.mcp']))
    expect(screen.getByText(en['external.capability.computer.backend.mcpNotice'])).toBeTruthy()
    expect(screen.queryByText(en['external.capability.computer.backend.nativeNotice'])).toBeNull()
  })

  it('installs the selected Browser Use provider and exposes its live terminal controls', async () => {
    const installId = '00000000-0000-4000-8000-000000000091' as PluginInstallId
    const running: PluginInstallSnapshot = {
      installId,
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-experimental-browser-use-stagehand-native@0.1.6-alpha.2',
      command: 'dsh plugin --profile web add @deepseek-ai/dsh-experimental-browser-use-stagehand-native@0.1.6-alpha.2',
      phase: 'running',
      installProgress: { stage: 'downloading', percent: 36 },
    }
    const installExternalTool = vi.fn(async () => running)
    render(<ExternalToolsSection {...props({
      installExternalTool,
      getInstall: async () => running,
      getInstallOutput: async () => ({
        text: 'Downloading Stagehand provider…\n',
        nextOffset: 32,
        lossy: false,
        settled: true,
      }),
    })} />)

    await screen.findByRole('heading', { name: 'Browser Use' })
    fireEvent.click(screen.getAllByRole('button', { name: en['external.capability.action.configure'] })[0]!)
    fireEvent.click(screen.getByLabelText(en['external.capability.browser.backend.stagehand']))
    fireEvent.click(screen.getByRole('button', { name: en['external.capability.action.installSelected'] }))

    await waitFor(() => { expect(installExternalTool).toHaveBeenCalledWith('browser-use-stagehand') })
    expect(screen.queryByRole('dialog', { name: 'Browser Use' })).toBeNull()
    const card = within(screen.getByRole('heading', { name: 'Browser Use' }).closest('li')!)
    expect(card.getByRole('group', { name: en['external.action.downloadControls'] })).toBeTruthy()
    fireEvent.click(card.getByRole('button', { name: en['external.action.viewProgress'] }))
    expect(await screen.findByRole('dialog', { name: en['external.progress.titleFor'].replace('{tool}', 'Browser Use') })).toBeTruthy()
    expect(await screen.findByText('Downloading Stagehand provider…')).toBeTruthy()
  })

  it('installs the selected Computer Use provider directly from its setup dialog', async () => {
    const installExternalTool = vi.fn(async (): Promise<PluginInstallSnapshot> => ({
      installId: '00000000-0000-4000-8000-000000000092' as PluginInstallId,
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp@0.1.6-alpha.2',
      command: 'dsh plugin --profile web add @deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp@0.1.6-alpha.2',
      phase: 'succeeded',
      exitCode: 0,
      installProgress: { stage: 'verifying', percent: 100 },
    }))
    render(<ExternalToolsSection {...props({ installExternalTool })} />)

    await screen.findByRole('heading', { name: 'Computer Use' })
    fireEvent.click(screen.getAllByRole('button', { name: en['external.capability.action.configure'] })[1]!)
    fireEvent.click(screen.getByLabelText(en['external.capability.computer.backend.mcp']))
    fireEvent.click(screen.getByRole('button', { name: en['external.capability.action.installSelected'] }))

    await waitFor(() => { expect(installExternalTool).toHaveBeenCalledWith('computer-use-mcp', 'computer-use-mcp') })
    expect(await within(screen.getByRole('heading', { name: 'Computer Use' }).closest('li')!)
      .findByRole('button', { name: en['external.action.restart'] })).toBeTruthy()
  })

  it('keeps a successfully installed Browser Use provider visible after the settings page remounts', async () => {
    const packageSpec = '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.1.6-alpha.2'
    const installed: PluginInstallSnapshot = {
      installId: '00000000-0000-4000-8000-000000000093' as PluginInstallId,
      profile: 'web',
      packageSpec,
      command: `dsh plugin --profile web add ${packageSpec}`,
      phase: 'succeeded',
      exitCode: 0,
      installProgress: { stage: 'verifying', percent: 100 },
    }
    const list = vi.fn()
      .mockResolvedValueOnce({
        entries: [],
        dependencyHealth: { lastRepair: null, quarantined: [], issues: [], diagnosticMode: null },
      })
      .mockResolvedValue({
        entries: [{
          entryId: 'community-desktop.experimental.browser-use-provider' as never,
          moduleName: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp',
          enabled: true,
          fiberPhase: 'active' as const,
        }],
        dependencyHealth: { lastRepair: null, quarantined: [], issues: [], diagnosticMode: null },
      })
    const installExternalTool = vi.fn(async () => installed)
    const injected = props({ list, installExternalTool })
    const first = render(<ExternalToolsSection {...injected} />)

    await screen.findByRole('heading', { name: 'Browser Use' })
    fireEvent.click(screen.getAllByRole('button', { name: en['external.capability.action.configure'] })[0]!)
    fireEvent.click(screen.getByRole('button', { name: en['external.capability.action.installSelected'] }))
    await waitFor(() => {
      expect(installExternalTool).toHaveBeenCalledWith(
        'browser-use-playwright',
        'browser-use-playwright-visible',
      )
    })
    const firstGrid = within(screen.getByTestId('experimental-capability-grid'))
    expect(await within(firstGrid.getByRole('heading', { name: 'Browser Use' }).closest('li')!)
      .findByRole('button', { name: en['external.action.restart'] })).toBeTruthy()

    first.unmount()
    render(<ExternalToolsSection {...injected} />)
    await screen.findByTestId('experimental-capability-grid')
    const remountedGrid = within(screen.getByTestId('experimental-capability-grid'))
    const remountedCard = within(remountedGrid.getByRole('heading', { name: 'Browser Use' }).closest('li')!)
    expect(remountedCard.queryByText(en['external.capability.status.notInstalled'])).toBeNull()
  })

  it('switches the active session after Auto review installation succeeds', async () => {
    const activateAutoReview = vi.fn(async () => 'switched' as const)
    const installExternalTool = vi.fn(async (): Promise<PluginInstallSnapshot> => ({
      installId: '00000000-0000-4000-8000-000000000099' as PluginInstallId,
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-experimental-auto-review@0.1.6-alpha.2',
      command: 'dsh plugin --profile web add @deepseek-ai/dsh-experimental-auto-review@0.1.6-alpha.2',
      phase: 'succeeded',
      exitCode: 0,
      installProgress: { stage: 'verifying', percent: 100 },
    }))
    render(<ExternalToolsSection {...props({ activateAutoReview, installExternalTool })} />)

    await screen.findByRole('heading', { name: 'Auto review' })
    fireEvent.click(screen.getAllByRole('button', { name: en['external.capability.action.configure'] })[2]!)
    fireEvent.click(await screen.findByLabelText(en['external.capability.review.acknowledge']))
    fireEvent.click(await screen.findByRole('button', { name: en['external.capability.review.install'] }))
    await waitFor(() => { expect(activateAutoReview).toHaveBeenCalledOnce() })
    expect(await screen.findByText(en['external.capability.review.switched'])).toBeTruthy()
  })

  it('shows a product icon for every tool and identifies WorkBuddy as a community plugin', async () => {
    render(<ExternalToolsSection {...props({
      list: async () => ({
        entries: [{
          entryId: 'dsh-workbuddy-connect' as PluginEntryId,
          moduleName: 'dsh-workbuddy-connect',
          enabled: true,
          fiberPhase: 'active',
        }],
        dependencyHealth: { lastRepair: null, quarantined: [], issues: [], diagnosticMode: null },
      }),
    })} />)

    await screen.findByRole('heading', { name: en['external.title'] })
    for (const tool of ['codex', 'claude-code', 'workbuddy', 'hermes', 'trae']) {
      expect(screen.getByTestId(`external-tool-icon-${tool}`).querySelector('svg')).toBeTruthy()
    }
    const workbuddyCard = screen.getByRole('heading', { name: 'WorkBuddy' }).closest('li')
    expect(workbuddyCard).not.toBeNull()
    const card = within(workbuddyCard!)
    expect(card.getByText(en['external.badge.community'])).toBeTruthy()
    expect(card.getByText(en['external.status.pluginReady'])).toBeTruthy()
    expect(card.getByRole('button', { name: en['external.action.pluginInstalled'] }).hasAttribute('disabled')).toBe(true)
  })

  it('installs the reviewed WorkBuddy connector through the community action', async () => {
    const installExternalTool = vi.fn(async (): Promise<PluginInstallSnapshot> => ({
      installId: '00000000-0000-4000-8000-000000000003' as PluginInstallId,
      profile: 'web',
      packageSpec: 'dsh-workbuddy-connect@0.5.0',
      command: 'dsh plugin --profile web add dsh-workbuddy-connect@0.5.0',
      phase: 'succeeded',
      exitCode: 0,
      installProgress: { stage: 'verifying', percent: 100 },
    }))
    render(<ExternalToolsSection {...props({ installExternalTool })} />)

    await screen.findByRole('heading', { name: en['external.title'] })
    fireEvent.click(screen.getByRole('button', { name: en['external.action.installCommunity'] }))
    await waitFor(() => { expect(installExternalTool).toHaveBeenCalledWith('workbuddy') })
  })

  it('waits for the user to restart after install and uses the restart action instead of reinstalling', async () => {
    const installExternalTool = vi.fn(async (): Promise<PluginInstallSnapshot> => ({
      installId: '00000000-0000-4000-8000-000000000004' as PluginInstallId,
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-subagent-codex',
      command: 'dsh plugin --profile web add @deepseek-ai/dsh-subagent-codex',
      phase: 'succeeded',
      exitCode: 0,
      installProgress: { stage: 'verifying', percent: 100 },
    }))
    const restart = vi.fn(async () => true)
    render(<ExternalToolsSection {...props({ installExternalTool, restart })} />)

    await screen.findByRole('heading', { name: en['external.title'] })
    fireEvent.click(screen.getAllByRole('button', { name: en['external.action.install'] })[0]!)
    const restartButton = await screen.findByRole('button', { name: en['external.action.restart'] })
    expect(restartButton.hasAttribute('disabled')).toBe(false)
    expect(restart).not.toHaveBeenCalled()

    fireEvent.click(restartButton)
    await waitFor(() => { expect(restart).toHaveBeenCalledOnce() })
    expect(installExternalTool).toHaveBeenCalledOnce()
  })

  it('shows an in-button percentage and preserves a viewable terminal after completion', async () => {
    const installId = '00000000-0000-4000-8000-000000000001' as PluginInstallId
    const running: PluginInstallSnapshot = {
      installId,
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-subagent-codex',
      command: 'dsh plugin --profile web add @deepseek-ai/dsh-subagent-codex',
      phase: 'running',
      installProgress: { stage: 'downloading', percent: 62, completed: 8, total: 13 },
    }
    const getInstall = vi.fn(async (): Promise<PluginInstallSnapshot> => ({
      ...running,
      phase: 'succeeded',
      exitCode: 0,
      installProgress: { stage: 'verifying', percent: 100 },
    }))
    const getInstallOutput = vi.fn(async () => ({
      text: 'Resolving dependencies…\nDownloaded package.\n',
      nextOffset: 47,
      lossy: true,
      settled: true,
    }))
    render(<ExternalToolsSection {...props({
      installExternalTool: async () => running,
      getInstall,
      getInstallOutput,
    })} />)

    await screen.findByRole('heading', { name: en['external.title'] })
    const codexCard = within(screen.getByRole('heading', { name: 'Codex' }).closest('li')!)
    expect(codexCard.getByRole('button', { name: en['external.action.viewProgress'] }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getAllByRole('button', { name: en['external.action.install'] })[0]!)
    await screen.findByText('Downloading 62%')
    const progressbar = screen.getByRole('progressbar', { name: 'Downloading 62%' })
    expect(progressbar.getAttribute('aria-valuenow')).toBe('62')

    fireEvent.click(codexCard.getByRole('button', { name: en['external.action.viewProgress'] }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(await screen.findByText('Downloaded package.')).toBeTruthy()
    expect(screen.getByText(en['external.progress.truncated'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['external.progress.close'] }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await waitFor(() => { expect(getInstall).toHaveBeenCalledWith(installId) }, { timeout: 1_500 })
    expect(codexCard.getByRole('button', { name: en['external.action.viewProgress'] }).hasAttribute('disabled')).toBe(false)
    expect(getInstallOutput).toHaveBeenCalledWith(installId, 0)
  })

  it('splits a running download into pause and stop controls and resumes only on request', async () => {
    const installId = '00000000-0000-4000-8000-000000000005' as PluginInstallId
    const running: PluginInstallSnapshot = {
      installId,
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-subagent-codex',
      command: 'dsh plugin --profile web add @deepseek-ai/dsh-subagent-codex',
      phase: 'running',
      installProgress: { stage: 'downloading', percent: 41, completed: 7, total: 17 },
    }
    const paused: PluginInstallSnapshot = { ...running, phase: 'paused' }
    const installExternalTool = vi.fn(async () => running)
    const pauseInstall = vi.fn(async () => paused)
    render(<ExternalToolsSection {...props({
      installExternalTool,
      pauseInstall,
      getInstall: async () => running,
    })} />)

    await screen.findByRole('heading', { name: en['external.title'] })
    fireEvent.click(screen.getAllByRole('button', { name: en['external.action.install'] })[0]!)
    expect(await screen.findByRole('group', { name: en['external.action.downloadControls'] })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(en['external.action.pause'], 'u') })).toBeTruthy()
    expect(screen.getByRole('button', { name: en['external.action.stop'] })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: new RegExp(en['external.action.pause'], 'u') }))
    await waitFor(() => { expect(pauseInstall).toHaveBeenCalledWith(installId) })
    expect(await screen.findByText(en['external.status.paused'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['external.action.resume'] }))
    await waitFor(() => { expect(installExternalTool).toHaveBeenCalledTimes(2) })
  })

  it('resumes an experimental capability with its original guarded recipe', async () => {
    const installId = '00000000-0000-4000-8000-000000000105' as PluginInstallId
    const running: PluginInstallSnapshot = {
      installId,
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.1.6-alpha.2',
      command: 'dsh plugin --profile web add @deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.1.6-alpha.2',
      phase: 'running',
      installProgress: { stage: 'downloading', percent: 41, completed: 7, total: 17 },
    }
    const installExternalTool = vi.fn(async () => running)
    const pauseInstall = vi.fn(async (): Promise<PluginInstallSnapshot> => ({ ...running, phase: 'paused' }))
    render(<ExternalToolsSection {...props({
      installExternalTool,
      pauseInstall,
      getInstall: async () => running,
    })} />)

    await screen.findByRole('heading', { name: 'Browser Use' })
    fireEvent.click(screen.getAllByRole('button', { name: en['external.capability.action.configure'] })[0]!)
    fireEvent.click(screen.getByRole('button', { name: en['external.capability.action.installSelected'] }))
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(en['external.action.pause'], 'u') }))
    await waitFor(() => { expect(pauseInstall).toHaveBeenCalledWith(installId) })
    fireEvent.click(await screen.findByRole('button', { name: en['external.action.resume'] }))
    await waitFor(() => {
      expect(installExternalTool).toHaveBeenLastCalledWith(
        'browser-use-playwright',
        'browser-use-playwright-visible',
      )
    })
  })

  it('stops a running download and offers a fresh download without resuming automatically', async () => {
    const installId = '00000000-0000-4000-8000-000000000006' as PluginInstallId
    const running: PluginInstallSnapshot = {
      installId,
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-subagent-claude-code',
      command: 'dsh plugin --profile web add @deepseek-ai/dsh-subagent-claude-code',
      phase: 'running',
      installProgress: { stage: 'resolving' },
    }
    const cancelInstall = vi.fn(async (): Promise<PluginInstallSnapshot> => ({ ...running, phase: 'cancelled' }))
    render(<ExternalToolsSection {...props({
      installExternalTool: async () => running,
      cancelInstall,
      getInstall: async () => running,
    })} />)

    await screen.findByRole('heading', { name: en['external.title'] })
    fireEvent.click(screen.getAllByRole('button', { name: en['external.action.install'] })[1]!)
    fireEvent.click(await screen.findByRole('button', { name: en['external.action.stop'] }))
    await waitFor(() => { expect(cancelInstall).toHaveBeenCalledWith(installId) })
    expect(await screen.findByText(en['external.status.cancelled'])).toBeTruthy()
    expect(screen.getByRole('button', { name: en['external.action.retryDownload'] })).toBeTruthy()
  })

  it('keeps the existing failure diagnostic after the progress dialog is opened', async () => {
    const failed: PluginInstallSnapshot = {
      installId: '00000000-0000-4000-8000-000000000002' as PluginInstallId,
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-subagent-codex',
      command: 'dsh plugin --profile web add @deepseek-ai/dsh-subagent-codex',
      phase: 'failed',
      exitCode: 1,
      installProgress: { stage: 'downloading', percent: 23, completed: 3, total: 13 },
      diagnostic: 'fetch failed',
    }
    render(<ExternalToolsSection {...props({
      installExternalTool: async () => failed,
      getInstallOutput: async () => ({ text: 'fetch failed\n', nextOffset: 13, lossy: false, settled: true }),
    })} />)
    await screen.findByRole('heading', { name: en['external.title'] })
    fireEvent.click(screen.getAllByRole('button', { name: en['external.action.install'] })[0]!)
    const codexCard = within(screen.getByRole('heading', { name: 'Codex' }).closest('li')!)
    fireEvent.click(await codexCard.findByRole('button', { name: en['external.action.viewProgress'] }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: en['external.progress.close'] }))
    fireEvent.click(screen.getByText(en['external.install.details']))
    expect(screen.getByText('fetch failed')).toBeTruthy()
  })
})
