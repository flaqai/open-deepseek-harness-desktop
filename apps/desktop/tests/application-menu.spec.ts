import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { applicationMenuTemplate, commandEnabled, isDesktopCommand, type DesktopMenuState } from '../src/application-menu.ts'

const state: DesktopMenuState = { platform: 'win32', locale: 'en', ready: true, busy: false, maximized: false, fullscreen: false, development: false }
function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap(item => [item, ...flatten(Array.isArray(item.submenu) ? item.submenu : [])])
}
describe('platform application menus', () => {
  it.each(['darwin', 'win32', 'linux'] as const)('provides product menus on %s', (platform) => {
    const menu = applicationMenuTemplate({ ...state, platform }, vi.fn())
    expect(menu.map(item => item.id)).toEqual([...(platform === 'darwin' ? ['app'] : []), 'file', 'edit', 'view', 'tools', 'window', 'help'])
    const items = flatten(menu)
    for (const id of ['new-session', 'settings', 'updates', 'market', 'snapshots', 'phone', 'im', 'restart', 'quit']) {
      expect(items.filter(item => item.id === id)).toHaveLength(1)
    }
    expect(items.some(item => item.id === 'open-web')).toBe(platform !== 'linux')
    expect(items.some(item => item.id === 'devtools')).toBe(false)
    expect(items.some(item => item.role === 'services')).toBe(platform === 'darwin')
  })
  it('localizes and dispatches commands while leaving update installation to Settings', () => {
    const execute = vi.fn()
    const items = flatten(applicationMenuTemplate({ ...state, locale: 'zh', maximized: true, fullscreen: true, development: true }, execute))
    expect(items.find(item => item.id === 'maximize')?.label).toBe('还原')
    expect(items.find(item => item.id === 'fullscreen')?.label).toBe('退出全屏')
    expect(items.some(item => item.id === 'devtools')).toBe(true)
    items.find(item => item.id === 'updates')?.click?.({} as never, undefined, {})
    expect(execute).toHaveBeenCalledWith('updates')
  })
  it('disables disconnected navigation and guarded mutations but retains recovery help', () => {
    expect(commandEnabled('new-session', { ...state, ready: false })).toBe(false)
    expect(commandEnabled('zoom-in', { ...state, ready: false })).toBe(false)
    expect(commandEnabled('open-web', { ...state, ready: false })).toBe(false)
    expect(commandEnabled('open-web', { ...state, platform: 'linux' })).toBe(false)
    expect(commandEnabled('restart', { ...state, busy: true })).toBe(false)
    expect(commandEnabled('quit', { ...state, busy: true })).toBe(false)
    for (const command of ['about', 'logs', 'docs'] as const) expect(commandEnabled(command, { ...state, ready: false, busy: true })).toBe(true)
    expect(isDesktopCommand('file:///private')).toBe(false)
    expect(isDesktopCommand('__proto__')).toBe(false)
    expect(isDesktopCommand('copy')).toBe(true)
  })
})
