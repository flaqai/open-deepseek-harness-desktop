// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import { PluginDiscovery } from '../src/client/PluginDiscovery.tsx'
import type {
  PluginInventorySettingsTabInjected,
  PluginInventorySettingsTabProps,
} from '../src/client/PluginInventorySettingsTab.tsx'
import type { PluginDiscoveryProps } from '../src/client/PluginDiscovery.tsx'
import type { PluginInstallId, PluginInstallSnapshot } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

type Snapshot = Awaited<ReturnType<PluginInventorySettingsTabInjected['list']>>
const t = ((key: PluginInventoryLocaleKey): string => en[key]) as PluginInventorySettingsTabProps['t']

function props(list: PluginInventorySettingsTabInjected['list']): PluginInventorySettingsTabProps {
  return {
    t,
    list,
    startUninstall: vi.fn(),
    getInstall: vi.fn(),
  } as PluginInventorySettingsTabProps
}

const SNAPSHOT = {
  entries: [
    { entryId: '8a1b2c3d', moduleName: '@deepseek-ai/cordis-plugin-hmr', enabled: true, fiberPhase: 'active' },
    { entryId: 'pending', moduleName: 'cordis:pending-name', enabled: true, fiberPhase: 'pending' },
    { entryId: 'loading', moduleName: '@fixture/loading-name', enabled: true, fiberPhase: 'loading' },
    { entryId: 'failed', moduleName: '@fixture/failed-name', enabled: true, fiberPhase: 'failed' },
    { entryId: 'unloading', moduleName: '@fixture/unloading-name', enabled: true, fiberPhase: 'unloading' },
    { entryId: 'unobserved', moduleName: '@fixture/unobserved-name', enabled: true, fiberPhase: null },
    { entryId: 'disabled-entry', moduleName: '@deepseek-ai/dsh-host-directory-picker-native', enabled: false, fiberPhase: null },
    { entryId: 'dsh-market', moduleName: 'dshmarket', enabled: true, fiberPhase: 'active' },
  ],
} as unknown as Snapshot

describe('PluginInventorySettingsTab', () => {
  it('renders runtime status only for enabled plugins', async () => {
    const deferred = Promise.withResolvers<Snapshot>()
    const list = vi.fn(() => deferred.promise)
    const view = render(<PluginInventorySettingsTab {...props(list)} />)
    expect(screen.getByText(en.loading)).toBeTruthy()

    await act(async () => { deferred.resolve(SNAPSHOT) })
    expect(list).toHaveBeenCalledOnce()
    expect(screen.getByRole('searchbox', { name: en.search })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.catalog })).toBeTruthy()
    expect(view.container.querySelector('[data-plugin-count]')?.textContent).toBe('8')
    expect(screen.getAllByRole('listitem')).toHaveLength(8)
    expect(screen.getAllByText(en.enabledTag)).toHaveLength(7)
    expect(screen.getByText(en.disabledTag)).toBeTruthy()
    for (const value of [
      'Mounted',
      'Waiting for dependencies',
      'Loading',
      'Mount failed',
      'Unloading',
      'Not mounted',
    ]) {
      expect(screen.getAllByRole('img', { name: value }).length).toBeGreaterThan(0)
    }
    const active = screen.getByRole('button', { name: 'hmr, Mounted, Enabled' })
    expect(active.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(active)
    expect(active.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelector('[data-loader-entry]')?.textContent).toBe('8a1b2c3d')
    expect(screen.getByText(en.configuration)).toBeTruthy()
    expect(screen.getByText(en.cordis)).toBeTruthy()
    fireEvent.click(active)
    expect(view.container.querySelector('[data-loader-entry]')).toBeNull()

    fireEvent.click(active)
    fireEvent.change(screen.getByRole('searchbox', { name: en.search }), {
      target: { value: 'disabled-entry' },
    })
    expect(view.container.querySelector('[data-loader-entry]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'directory-picker-native, Disabled' }))
    expect(screen.getAllByText(en.disabledTag)).toHaveLength(2)
    expect(screen.queryByText(en.cordis)).toBeNull()
    expect(screen.queryByText(en.unobserved)).toBeNull()
  })

  it('confirms and invokes the core dshmarket uninstall operation', async () => {
    const succeeded: PluginInstallSnapshot = {
      installId: 'remove-1' as PluginInstallId,
      profile: 'web',
      packageSpec: 'dshmarket',
      command: 'dsh plugin --profile web remove dshmarket',
      phase: 'succeeded',
      exitCode: 0,
    }
    const startUninstall = vi.fn(async () => succeeded)
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT)} startUninstall={startUninstall} />)
    fireEvent.click(await screen.findByRole('button', { name: 'dshmarket, Mounted, Enabled' }))
    fireEvent.click(screen.getByRole('button', { name: en['uninstall.action'] }))
    const confirm = screen.getByRole('button', { name: en['uninstall.confirm.action'] })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: en['uninstall.confirm.acknowledge'] }))
    fireEvent.click(confirm)
    await waitFor(() => { expect(startUninstall).toHaveBeenCalledWith({ profile: 'web', packageName: 'dshmarket' }) })
    expect(await screen.findByText(en['uninstall.succeeded'])).toBeTruthy()
  })

  it('filters by module name or Loader entry id', async () => {
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT)} />)
    const search = await screen.findByRole('searchbox', { name: en.search })

    fireEvent.change(search, { target: { value: 'disabled-entry' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('directory-picker-native')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'cordis-plugin-hmr' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('hmr')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'not-a-plugin' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
  })

  it('shows a generic failure and retries into the empty state', async () => {
    const list = vi.fn<PluginInventorySettingsTabInjected['list']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce({ entries: [] })
    render(<PluginInventorySettingsTab {...props(list)} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.empty)).toBeTruthy()
  })

  it('contains a synchronous Remote failure and ignores a result after unmount', async () => {
    const syncFailure = vi.fn(() => { throw new Error('namespace unavailable') }) as PluginInventorySettingsTabInjected['list']
    const failed = render(<PluginInventorySettingsTab {...props(syncFailure)} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    failed.unmount()

    const deferred = Promise.withResolvers<Snapshot>()
    const pending = render(<PluginInventorySettingsTab {...props(() => deferred.promise)} />)
    pending.unmount()
    await act(async () => { deferred.resolve(SNAPSHOT) })

    const deferredFailure = Promise.withResolvers<Snapshot>()
    const pendingFailure = render(<PluginInventorySettingsTab {...props(() => deferredFailure.promise)} />)
    pendingFailure.unmount()
    await act(async () => { deferredFailure.reject(new Error('late failure')) })
  })
})

describe('PluginDiscovery', () => {
  const installed: PluginInstallSnapshot = {
    installId: 'install-1' as PluginInstallId,
    profile: 'web',
    packageSpec: '@linxin666/dsh-web-ui-all',
    command: 'dsh plugin --profile web add @linxin666/dsh-web-ui-all',
    phase: 'succeeded',
    exitCode: 0,
  }
  const startInstall = vi.fn(async () => installed)
  const getInstall = vi.fn(async () => installed)
  const discoveryProps = { t, startInstall, getInstall } as PluginDiscoveryProps

  it('opens the curated guide and copies an official CLI install command', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(<PluginDiscovery {...discoveryProps} />)

    const trigger = screen.getByRole('button', { name: /Explore plugins/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('dialog', { name: en['discovery.title'] })).toBeTruthy()
    expect(screen.getAllByText(en['discovery.thirdParty'])).toHaveLength(5)
    expect(screen.getByText(en['discovery.notice'])).toBeTruthy()
    expect(screen.getByText(en['discovery.collected'])).toBeTruthy()
    expect(screen.getByRole('link', { name: en['discovery.more'] }).getAttribute('href'))
      .toBe('https://github.com/topics/dsh-plugin')

    fireEvent.click(screen.getAllByRole('button', { name: en['discovery.copy'] })[0]!)
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('dsh plugin --profile web add @linxin666/dsh-web-ui-all')
    })
    expect(screen.getByRole('button', { name: en['discovery.copied'] })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en['discovery.close'] }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(trigger)
    expect(screen.queryByRole('button', { name: en['discovery.copied'] })).toBeNull()
  })

  it('keeps the copy label when the browser refuses clipboard access', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => { throw new Error('denied') }) },
    })
    render(<PluginDiscovery {...discoveryProps} />)
    fireEvent.click(screen.getByRole('button', { name: /Explore plugins/ }))
    fireEvent.click(screen.getAllByRole('button', { name: en['discovery.copy'] })[0]!)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('button', { name: en['discovery.copied'] })).toBeNull()
  })

  it('confirms and starts a reviewed structured plugin installation', async () => {
    startInstall.mockClear()
    render(<PluginDiscovery {...discoveryProps} />)
    fireEvent.click(screen.getByRole('button', { name: /Explore plugins/ }))
    fireEvent.click(screen.getAllByRole('button', { name: en['discovery.install.action'] })[0]!)

    const confirmation = screen.getByRole('dialog', { name: en['discovery.confirm.title'] })
    const confirm = screen.getByRole('button', { name: en['discovery.confirm.install'] })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: en['discovery.confirm.acknowledge'] }))
    expect(confirm.hasAttribute('disabled')).toBe(false)
    fireEvent.click(confirm)

    await waitFor(() => {
      expect(startInstall).toHaveBeenCalledWith({
        profile: 'web',
        packageSpec: '@linxin666/dsh-web-ui-all',
      })
    })
    expect(screen.queryByRole('dialog', { name: en['discovery.confirm.title'] })).toBeNull()
    expect(await screen.findByText(en['discovery.install.succeeded'])).toBeTruthy()
    expect(confirmation.isConnected).toBe(false)
  })
})
