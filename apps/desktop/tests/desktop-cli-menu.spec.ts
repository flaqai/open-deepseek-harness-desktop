import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopCliStatus } from '../src/desktop-cli-registration.ts'
import { DesktopCliMenu, findCurrentDshCommand } from '../src/desktop-cli-menu.ts'

function fixture(phase: DesktopCliStatus['phase'] = 'uninstalled', platform: NodeJS.Platform = 'darwin') {
  const state: DesktopCliStatus = { phase, commandPath: '/Users/test/Desktop/cli/bin/dsh', dataHome: '/Users/test/dsh-home' }
  const manager = {
    getStatus: vi.fn(async () => state),
    install: vi.fn<(force: boolean) => Promise<DesktopCliStatus>>(async () => ({ ...state, phase: 'installed' })),
    remove: vi.fn(async () => ({ ...state, phase: 'uninstalled' as const })),
  }
  const responses: number[] = []
  const show = vi.fn<(options: MessageBoxOptions) => Promise<MessageBoxReturnValue>>(
    async () => ({ response: responses.shift() ?? 0, checkboxChecked: false }),
  )
  const menu = new DesktopCliMenu({ manager, platform, locale: () => 'zh', show,
    findCurrent: async () => ({ unknown: false }) })
  return { menu, manager, show, responses }
}

describe('DesktopCliMenu', () => {
  it('finds a Linux PATH command without executing it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-command-menu-'))
    try {
      await writeFile(join(directory, 'dsh'), '#!/bin/sh\n', { mode: 0o755 })
      await expect(findCurrentDshCommand('linux', { PATH: directory }))
        .resolves.toEqual({ path: join(directory, 'dsh'), unknown: false })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('shows the packaged command path and installs only after an explicit click', async () => {
    const { menu, manager, show } = fixture()
    await menu.show()
    expect(show.mock.calls[0]?.[0].message).toBe('将 Desktop dsh 命令添加到终端？')
    expect(show.mock.calls[0]?.[0].detail).toContain('Desktop 命令：/Users/test/Desktop/cli/bin/dsh')
    expect(show.mock.calls[0]?.[0].buttons).toEqual(['安装', '关闭'])
    expect(show.mock.calls[0]?.[0].cancelId).toBe(1)
    expect(manager.install).toHaveBeenCalledExactlyOnceWith(false)
    expect(show.mock.calls[1]?.[0].message).toBe('已安装 Desktop dsh 命令。')
  })

  it('keeps a competing command until the user confirms shadowing it', async () => {
    const { manager, show, responses } = fixture('conflict', 'win32')
    const conflicted = new DesktopCliMenu({ manager, platform: 'win32', locale: () => 'en', show,
      findCurrent: async () => ({ path: 'C:\\Program Files\\dsh.cmd', unknown: false }) })
    responses.push(0, 1)
    await conflicted.show()
    expect(manager.install).not.toHaveBeenCalled()
    expect(show.mock.calls[1]?.[0]).toMatchObject({ defaultId: 1, cancelId: 1 })
    responses.push(0, 0)
    await conflicted.show()
    expect(manager.install).toHaveBeenCalledExactlyOnceWith(true)
    expect(show.mock.calls[3]?.[0].message).toBe('Another dsh command was found. Installing Desktop dsh will not remove it.')
  })

  it('offers repair and removal for an installed Desktop command', async () => {
    const { menu, manager, show, responses } = fixture('installed')
    responses.push(1)
    await menu.show()
    expect(show.mock.calls[0]?.[0].buttons).toEqual(['关闭', '修复', '移除'])
    expect(manager.install).toHaveBeenCalledExactlyOnceWith(false)
    responses.push(2)
    await menu.show()
    expect(manager.remove).toHaveBeenCalledOnce()
  })

  it('checks Linux without offering unsupported automatic registration', async () => {
    const { manager, show } = fixture('unsupported', 'linux')
    const menu = new DesktopCliMenu({ manager, platform: 'linux', locale: () => 'zh', show,
      findCurrent: async () => ({ path: '/usr/bin/dsh', unknown: false }) })
    await menu.show()
    expect(show.mock.calls[0]?.[0].message).toContain('Linux')
    expect(show.mock.calls[0]?.[0].detail).toBe('当前 dsh 命令：/usr/bin/dsh')
    expect(show.mock.calls[0]?.[0].buttons).toEqual(['关闭'])
    expect(manager.install).not.toHaveBeenCalled()
    expect(manager.remove).not.toHaveBeenCalled()
  })

  it('does not mutate PATH from a development build', async () => {
    const { menu, manager, show } = fixture('unsupported')
    await menu.show()
    expect(show.mock.calls[0]?.[0].message).toContain('正式安装')
    expect(manager.install).not.toHaveBeenCalled()
  })
})
