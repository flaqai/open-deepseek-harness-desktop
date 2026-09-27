/** Privilege-minimal bridge for the dedicated floating window. */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC } from './desktop-ipc-protocol.ts'

/** Fixed host operations available only to the floating renderer. */
export interface OrbRendererBridge {
  expand(): Promise<void>
  collapse(): Promise<void>
  hide(): Promise<void>
  openMain(): Promise<void>
  openSettings(): Promise<void>
  onSelectionText(callback: (text: string) => void): () => void
}

let pendingSelectionText: string | undefined
const selectionListeners = new Set<(text: string) => void>()
ipcRenderer.on(DESKTOP_IPC.orbSelectionText, (_event, value: unknown) => {
  if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1'
    || new URLSearchParams(location.search).get('surface') !== 'orb'
    || typeof value !== 'string' || value.length === 0 || value.length > 8192) return
  if (selectionListeners.size === 0) { pendingSelectionText = value; return }
  for (const listener of selectionListeners) listener(value)
})

const bridge: OrbRendererBridge = Object.freeze({
  expand: () => ipcRenderer.invoke(DESKTOP_IPC.orbExpand) as Promise<void>,
  collapse: () => ipcRenderer.invoke(DESKTOP_IPC.orbCollapse) as Promise<void>,
  hide: () => ipcRenderer.invoke(DESKTOP_IPC.orbHide) as Promise<void>,
  openMain: () => ipcRenderer.invoke(DESKTOP_IPC.orbOpenMain) as Promise<void>,
  openSettings: () => ipcRenderer.invoke(DESKTOP_IPC.orbOpenSettings) as Promise<void>,
  onSelectionText(callback: (text: string) => void) {
    selectionListeners.add(callback)
    if (pendingSelectionText !== undefined) {
      const text = pendingSelectionText
      pendingSelectionText = undefined
      callback(text)
    }
    return () => { selectionListeners.delete(callback) }
  },
})

contextBridge.exposeInMainWorld('dshOrb', bridge)

window.addEventListener('DOMContentLoaded', () => {
  if (location.protocol !== 'file:') return
  const expand = document.getElementById('orb-expand')
  if (!(expand instanceof HTMLButtonElement)) return
  expand.setAttribute('aria-label', navigator.language.startsWith('zh') ? '打开悬浮聊天' : 'Open floating chat')
  const applyAppearance = (settings: { avatar: 'deepseek' | 'minimal' }): void => {
    document.body.toggleAttribute('data-avatar', settings.avatar === 'minimal')
    if (settings.avatar === 'minimal') document.body.setAttribute('data-avatar', 'minimal')
  }
  ipcRenderer.on(DESKTOP_IPC.orbChanged, (_event, settings: { avatar: 'deepseek' | 'minimal' }) => {
    applyAppearance(settings)
  })
  void ipcRenderer.invoke(DESKTOP_IPC.orbGet).then((settings: { avatar: 'deepseek' | 'minimal' }) => {
    applyAppearance(settings)
  }).catch((error: unknown) => { console.error('desktop: orb appearance could not be read', error) })
  expand.addEventListener('click', () => { void bridge.expand() })
})
