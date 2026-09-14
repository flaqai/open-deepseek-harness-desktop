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
    restart: async () => false,
    ...overrides,
  } as ExternalToolsSectionProps
}

describe('ExternalToolsSection download progress', () => {
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
    const viewButtons = screen.getAllByRole('button', { name: en['external.action.viewProgress'] })
    expect(viewButtons[0]?.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getAllByRole('button', { name: en['external.action.install'] })[0]!)
    await screen.findByText('Downloading 62%')
    const progressbar = screen.getByRole('progressbar', { name: 'Downloading 62%' })
    expect(progressbar.getAttribute('aria-valuenow')).toBe('62')

    fireEvent.click(screen.getAllByRole('button', { name: en['external.action.viewProgress'] })[0]!)
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(await screen.findByText('Downloaded package.')).toBeTruthy()
    expect(screen.getByText(en['external.progress.truncated'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['external.progress.close'] }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await waitFor(() => { expect(getInstall).toHaveBeenCalledWith(installId) }, { timeout: 1_500 })
    expect(screen.getAllByRole('button', { name: en['external.action.viewProgress'] })[0]?.hasAttribute('disabled')).toBe(false)
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
    fireEvent.click((await screen.findAllByRole('button', { name: en['external.action.viewProgress'] }))[0]!)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: en['external.progress.close'] }))
    fireEvent.click(screen.getByText(en['external.install.details']))
    expect(screen.getByText('fetch failed')).toBeTruthy()
  })
})
