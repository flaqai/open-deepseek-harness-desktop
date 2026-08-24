// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginInstallId } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import { BetterSidebarInstallCard, type BetterSidebarInstallCardProps } from '../src/client/BetterSidebarInstallCard.tsx'
import type { DesktopBundledPluginInstallSnapshot } from '../src/client/bundled-install-bridge.ts'
import { zh, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const running: DesktopBundledPluginInstallSnapshot = {
  installId: 'desktop-bundled:sidebar' as PluginInstallId,
  profile: 'web',
  packageSpec: 'dsh-better-sidebar@0.15.2',
  command: 'dsh plugin --profile web add dsh-better-sidebar@0.15.2',
  phase: 'running',
  stage: 'extracting',
  progress: 46,
}

function props(overrides: Partial<BetterSidebarInstallCardProps> = {}): BetterSidebarInstallCardProps {
  return {
    t: key => key in zh ? zh[key as PluginInventoryLocaleKey] : String(key),
    startInstall: vi.fn(async () => running),
    getInstall: vi.fn(async () => running),
    openLog: vi.fn(async () => true),
    restart: vi.fn(async () => true),
    ...overrides,
  } as BetterSidebarInstallCardProps
}

describe('BetterSidebarInstallCard', () => {
  it('shows truthful extraction progress and hides without cancelling the job', async () => {
    const viewProps = props()
    render(<BetterSidebarInstallCard {...viewProps} />)
    expect(await screen.findByText('正在解压 · 46%')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('46')
    fireEvent.click(screen.getByRole('button', { name: '隐藏' }))
    expect(screen.queryByText('正在准备 Better Sidebar')).toBeNull()
    expect(viewProps.getInstall).not.toHaveBeenCalled()
  })

  it('reappears on completion and exposes a narrow application restart', async () => {
    const getInstall = vi.fn(async () => ({ ...running, phase: 'succeeded' as const, stage: 'configuring' as const, progress: 100 }))
    const restart = vi.fn(async () => true)
    const viewProps = props({ getInstall, restart })
    render(<BetterSidebarInstallCard {...viewProps} />)
    expect(await screen.findByText('正在解压 · 46%')).toBeTruthy()
    await vi.waitFor(() => { expect(screen.getByText('Better Sidebar 已准备完成')).toBeTruthy() }, { timeout: 1_500 })
    fireEvent.click(screen.getByRole('button', { name: '重新启动应用' }))
    expect(restart).toHaveBeenCalledOnce()
  })

  it('offers retry and the Harness log after a failed start', async () => {
    const startInstall = vi.fn()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce(running)
    const openLog = vi.fn(async () => true)
    render(<BetterSidebarInstallCard {...props({ startInstall, openLog })} />)
    expect(await screen.findByText('Better Sidebar 准备失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看日志' }))
    expect(openLog).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('正在解压 · 46%')).toBeTruthy()
    expect(startInstall).toHaveBeenCalledTimes(2)
  })
})
