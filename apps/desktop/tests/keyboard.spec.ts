import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { BrowserWindow } from 'electron'
import type { ShortcutConfigSnapshot } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { DESKTOP_IPC } from '../src/desktop-ipc-protocol.ts'

const ipc = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn() }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class NativeWebContents extends EventEmitter {
    mainFrame = { url: '', name: '', parent: null }
    focusedFrame = this.mainFrame
    isDestroyed = () => false
    isFocused = () => true
    send = vi.fn()
    setIgnoreMenuShortcuts = vi.fn()
    focus = vi.fn()
    sendInputEvent = vi.fn()
  }
  class NativeWindow extends EventEmitter {
    webContents = new NativeWebContents()
    isDestroyed = () => false
    isFocused = () => true
    isEnabled = () => true
    close = vi.fn()
  }
  return { ipcMain: ipc, BrowserWindow: NativeWindow }
})
const { installDesktopShortcuts } = await import('../src/keyboard.ts')

it('keeps shortcut preferences device-local and rejects the split titlebar and other Runtime origins', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'dsh-shortcuts-'))
  onTestFinished(async () => { await rm(userData, { recursive: true, force: true }) })
  const frame = { url: 'https://nas.example/app', name: '', parent: null }
  const renderer = new BrowserWindow().webContents
  const send = vi.spyOn(renderer, 'send')
  Object.defineProperties(renderer, { mainFrame: { value: frame }, focusedFrame: { value: frame } })
  const window = new BrowserWindow()
  const titlebar = window.webContents
  Object.defineProperty(titlebar, 'mainFrame', { value: { url: 'file:///titlebar.html' } })
  const shortcuts = installDesktopShortcuts(
    () => window, () => renderer,
    url => new URL(url).origin === 'https://nas.example', userData, 'windows', () => {},
    () => ({ revision: 0, blocked: false }),
  )
  shortcuts.attach(window)
  onTestFinished(() => { shortcuts.dispose() })
  const loadingInput = { preventDefault: vi.fn(), defaultPrevented: false }
  renderer.emit('before-input-event', loadingInput, { type: 'keyDown', code: 'KeyA', key: 'a', modifiers: [],
    control: false, alt: false, shift: false, meta: false, isComposing: false, isAutoRepeat: false })
  expect(loadingInput.preventDefault).not.toHaveBeenCalled()
  const handlers = new Map<string, (event: { sender: object; senderFrame: object }, value: unknown) => Promise<ShortcutConfigSnapshot>>(
    ipc.handle.mock.calls.map(([channel, handler]) => [channel, handler]),
  )
  const get = handlers.get(DESKTOP_IPC.shortcutsGet)!
  await expect(get({ sender: titlebar, senderFrame: titlebar.mainFrame }, [])).rejects.toThrow('rejected sender')
  frame.url = 'https://other.example/app'
  await expect(get({ sender: renderer, senderFrame: frame }, [])).rejects.toThrow('rejected sender')
  frame.url = 'https://nas.example/app'
  const snapshot = await get({ sender: renderer, senderFrame: frame }, [])
  expect(snapshot.status).toBe('ready')
  expect(send).toHaveBeenCalledWith(DESKTOP_IPC.shortcutsChanged, snapshot)
})
