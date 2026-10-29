import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { installConversationNavigation } from '../src/conversation-navigation.ts'
import { DESKTOP_IPC } from '../src/desktop-ipc-protocol.ts'

function setup() {
  const window = Object.assign(new EventEmitter(), { isFocused: () => true, isEnabled: () => true })
  const renderer = { isDestroyed: () => false, send: vi.fn() }
  const allowed = vi.fn(() => true)
  const dispose = installConversationNavigation(window, renderer, allowed)
  return { window, renderer, allowed, dispose }
}

it.each([['browser-backward', 'back'], ['browser-forward', 'forward']])('routes %s to conversation navigation without native history', (command, direction) => {
  const h = setup()
  const event = { preventDefault: vi.fn() }
  h.window.emit('app-command', event, command)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(h.renderer.send).toHaveBeenCalledExactlyOnceWith(DESKTOP_IPC.conversationNavigation, direction)
  h.dispose()
})

it('ignores unrelated commands and removes its listeners on close', () => {
  const h = setup()
  const event = { preventDefault: vi.fn() }
  h.window.emit('app-command', event, 'browser-refresh')
  expect(event.preventDefault).not.toHaveBeenCalled()
  expect(h.renderer.send).not.toHaveBeenCalled()
  h.window.emit('closed')
  h.window.emit('app-command', event, 'browser-backward')
  expect(event.preventDefault).not.toHaveBeenCalled()
  expect(h.window.listenerCount('app-command')).toBe(0)
  h.dispose()
})

it('consumes navigation while startup or recovery cannot receive it', () => {
  const h = setup()
  h.allowed.mockReturnValue(false)
  const event = { preventDefault: vi.fn() }
  h.window.emit('app-command', event, 'browser-backward')
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(h.renderer.send).not.toHaveBeenCalled()
  h.dispose()
})
