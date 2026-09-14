import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ShortcutDetails } from 'electron'
import { updateIconShortcuts } from '../src/icon-shortcuts.ts'

const roots: string[] = []
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'icon-shortcuts-')); roots.push(root)
  const desktop = join(root, 'Desktop')
  const startMenu = join(root, 'Programs')
  mkdirSync(desktop); mkdirSync(startMenu)
  const executable = 'C:\\应用 目录\\Open DeepSeek Harness Desktop.exe'
  const links = new Map<string, ShortcutDetails>()
  const read = vi.fn((path: string): ShortcutDetails => {
    const link = links.get(path)
    if (link === undefined) throw new Error('unreadable')
    return link
  })
  const write = vi.fn(() => true)
  const options = { desktop, startMenu, executable, managedDirectory: 'C:\\Users\\用户\\AppData\\icons', appId: 'ai.flaq.deepseek-harness', read, write }
  const add = (directory: string, name: string, link: ShortcutDetails): string => {
    const path = join(directory, name); writeFileSync(path, 'link'); links.set(path, link); return path
  }
  return { options, add, write, read, root }
}
describe('owned current-user Windows shortcuts', () => {
  it('updates desktop and nested Start Menu links, preserving launch and toast fields', () => {
    const { options, add, write } = setup()
    const original = { target: options.executable, args: '--hidden 中文', cwd: 'C:\\work dir', description: 'custom name', toastActivatorClsid: 'clsid' }
    const path = add(options.desktop, '自定义名称.lnk', original)
    mkdirSync(join(options.startMenu, 'Open DeepSeek Harness Desktop'))
    add(join(options.startMenu, 'Open DeepSeek Harness Desktop'), '启动.lnk', { target: options.executable.toLowerCase(), icon: options.executable })
    expect(updateIconShortcuts(options, 'C:\\icons\\new.ico')).toEqual([
      { surface: 'desktop', name: '自定义名称.lnk', status: 'applied' },
      { surface: 'start-menu', name: '启动.lnk', status: 'applied' },
    ])
    expect(write).toHaveBeenCalledWith(path, 'update', { ...original, icon: 'C:\\icons\\new.ico', iconIndex: 0 })
  })
  it('does not recurse into large Desktop project trees before updating a top-level shortcut', () => {
    const { options, add, write } = setup()
    const project = join(options.desktop, 'project', 'node_modules')
    mkdirSync(project, { recursive: true })
    for (let index = 0; index < 2100; index++) writeFileSync(join(project, `entry-${index}.js`), '')
    const path = add(options.desktop, 'Open DeepSeek Harness Desktop.lnk', { target: options.executable })
    add(project, 'nested.lnk', { target: options.executable })

    expect(updateIconShortcuts(options, 'C:\\icons\\new.ico')).toContainEqual({
      surface: 'desktop', name: 'Open DeepSeek Harness Desktop.lnk', status: 'applied',
    })
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(path, 'update', expect.objectContaining({ icon: 'C:\\icons\\new.ico' }))
  })
  it('reports a shortcut-count limit separately from file permission failures', () => {
    const { options } = setup()
    for (let index = 0; index <= 2000; index++) writeFileSync(join(options.startMenu, `${index}.lnk`), '')

    expect(updateIconShortcuts(options, options.executable)).toContainEqual({
      surface: 'start-menu', status: 'scan-limit',
    })
  })
  it('never modifies another installation, AppID, external icon, or symlink', () => {
    const { options, add, write, root } = setup()
    add(options.desktop, 'other.lnk', { target: 'C:\\other\\Other Application.exe' })
    add(options.desktop, 'other-id.lnk', { target: options.executable, appUserModelId: 'other' })
    add(options.desktop, 'custom.lnk', { target: options.executable, icon: 'C:\\art\\custom.ico' })
    add(options.desktop, 'resource.lnk', { target: options.executable, icon: options.executable, iconIndex: 2 })
    const outside = add(root, 'outside.lnk', { target: options.executable })
    symlinkSync(outside, join(options.desktop, 'linked.lnk'))
    const result = updateIconShortcuts(options, options.executable)
    expect(write).not.toHaveBeenCalled()
    expect(result).toContainEqual({ surface: 'desktop', name: 'custom.lnk', status: 'external' })
  })
  it('reapplies an owned icon after upgrade but does not accept arbitrary files in the managed directory', () => {
    const { options, add, write } = setup()
    add(options.desktop, 'managed.lnk', { target: options.executable, icon: `${options.managedDirectory}\\${'a'.repeat(64)}.ico` })
    add(options.desktop, 'external.lnk', { target: options.executable, icon: `${options.managedDirectory}\\custom.ico` })
    updateIconShortcuts(options, options.executable)
    expect(write).toHaveBeenCalledTimes(1)
  })
  it('reports missing without creating, then creates only on explicit request', () => {
    const { options, write } = setup()
    expect(updateIconShortcuts(options, options.executable)).toEqual([{ surface: 'desktop', status: 'missing' }, { surface: 'start-menu', status: 'missing' }])
    expect(write).not.toHaveBeenCalled()
    const results = updateIconShortcuts(options, options.executable, true)
    expect(write).toHaveBeenCalledWith(join(options.desktop, 'Open DeepSeek Harness Desktop.lnk'), 'create', expect.objectContaining({ target: options.executable, appUserModelId: options.appId }))
    expect(results).not.toContainEqual({ surface: 'desktop', status: 'missing' })
  })
  it('does not replace a same-named unrelated shortcut', () => {
    const { options, add, write } = setup()
    add(options.desktop, 'Open DeepSeek Harness Desktop.lnk', { target: 'C:\\other.exe' })
    expect(updateIconShortcuts(options, options.executable, true)).toContainEqual({ surface: 'desktop', status: 'external' })
    expect(write).not.toHaveBeenCalled()
  })
  it('reports permission failure independently for each shortcut', () => {
    const { options, add, write } = setup()
    add(options.desktop, 'one.lnk', { target: options.executable })
    add(options.startMenu, 'two.lnk', { target: options.executable })
    write.mockReturnValueOnce(false).mockReturnValueOnce(true)
    expect(updateIconShortcuts(options, options.executable).map(result => result.status)).toEqual(['unavailable', 'applied'])
  })
})
