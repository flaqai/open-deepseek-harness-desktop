/** Native mouse/browser commands navigate conversations instead of the renderer document. */
import type { WebContents } from 'electron'
import { DESKTOP_IPC } from './desktop-ipc-protocol.ts'

type NavigationCommand = (event: { preventDefault(): void }, command: string) => void
interface NavigationWindow {
  on(event: 'app-command', listener: NavigationCommand): void
  once(event: 'closed', listener: () => void): void
  off(event: 'app-command', listener: NavigationCommand): void
  off(event: 'closed', listener: () => void): void
  isFocused(): boolean
  isEnabled(): boolean
}

/**
 * Consume native Back/Forward commands, including mice on Windows and Linux.
 * @param window - Product window receiving application commands.
 * @param renderer - Harness renderer, including split titlebar windows.
 * @param available - Whether the trusted client can receive navigation.
 * @returns Idempotent listener cleanup; window closure also disposes it.
 */
export function installConversationNavigation(
  window: NavigationWindow,
  renderer: Pick<WebContents, 'isDestroyed' | 'send'>,
  available: () => boolean,
): () => void {
  const command = (event: { preventDefault(): void }, value: string): void => {
    const direction = value === 'browser-backward' ? 'back' : value === 'browser-forward' ? 'forward' : undefined
    if (direction === undefined) return
    event.preventDefault()
    if (!window.isFocused() || !window.isEnabled() || renderer.isDestroyed() || !available()) return
    renderer.send(DESKTOP_IPC.conversationNavigation, direction)
  }
  const dispose = (): void => {
    window.off('app-command', command)
    window.off('closed', dispose)
  }
  window.on('app-command', command)
  window.once('closed', dispose)
  return dispose
}
