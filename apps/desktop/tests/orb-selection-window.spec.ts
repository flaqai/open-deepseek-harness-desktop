import { describe, expect, it } from 'vitest'
import {
  createOrbSelectionWindowController, orbSelectionToolbarBounds, parseOrbSelectionActionUrl,
  type OrbSelectionToolbarAction, type OrbSelectionToolbarRect, type OrbSelectionToolbarWindow,
} from '../src/orb-selection-window.ts'
import type { OrbSelectionActions } from '../src/orb-selection.ts'

const left: OrbSelectionToolbarRect = { x: -1280, y: 0, width: 1280, height: 800 }
const right: OrbSelectionToolbarRect = { x: 0, y: 0, width: 1920, height: 1080 }

function harness() {
  let local = true
  let positioned = true
  let taskRunning = false
  let inputActive = false
  const windows: Array<OrbSelectionToolbarWindow & {
    visible: boolean
    destroyed: boolean
    bounds: OrbSelectionToolbarRect | undefined
    activate(action: OrbSelectionToolbarAction): void
  }> = []
  const calls: string[] = []
  const actions: OrbSelectionActions = {
    async search() { calls.push('search') },
    translate(language) { calls.push(`translate-${language}`) },
    attach() { calls.push('attach') },
  }
  const controller = createOrbSelectionWindowController({
    canShowLocal: () => local,
    supportsPositioning: () => positioned,
    workAreas: () => [left, right],
    locale: () => 'zh-CN',
    createWindow() {
      let handler: ((action: OrbSelectionToolbarAction) => void) | undefined
      const window = {
        webContentsId: windows.length + 11,
        visible: false,
        destroyed: false,
        bounds: undefined as OrbSelectionToolbarRect | undefined,
        async load() {},
        setActionHandler(next: (action: OrbSelectionToolbarAction) => void) { handler = next },
        setBounds(bounds: OrbSelectionToolbarRect) { this.bounds = bounds },
        showInactive() { this.visible = true },
        hide() { this.visible = false; handler = undefined },
        destroy() { this.destroyed = true; handler = undefined },
        isDestroyed() { return this.destroyed },
        activate(action: OrbSelectionToolbarAction) { handler?.(action) },
      }
      windows.push(window)
      return window
    },
  })
  return {
    controller, actions, calls,
    get windows() { return windows },
    setLocal(value: boolean) { local = value; controller.refreshAuthority() },
    setPositioned(value: boolean) { positioned = value; controller.refreshAuthority() },
    setTaskRunning(value: boolean) { taskRunning = value; controller.setTaskRunning(value) },
    setInputActive(value: boolean) { inputActive = value; controller.setInputActive(value) },
    get paused() { return taskRunning || inputActive },
  }
}

describe('cross-app selection toolbar', () => {
  it('clamps on the selected display in DIP, including a negative-origin secondary display', () => {
    expect(orbSelectionToolbarBounds({ x: -100, y: 790 }, [left, right])).toEqual({
      x: -356, y: 748, width: 356, height: 52,
    })
    expect(orbSelectionToolbarBounds({ x: 1910, y: 100 }, [left, right])).toEqual({
      x: 1564, y: 108, width: 356, height: 52,
    })
    expect(orbSelectionToolbarBounds({ x: 5000, y: 50 }, [left, right])).toBeUndefined()
    expect(orbSelectionToolbarBounds({ x: NaN, y: 50 }, [left, right])).toBeUndefined()
  })

  it('accepts only exact fixed action navigation URLs', () => {
    expect(parseOrbSelectionActionUrl('orb-selection-action://attach/')).toBe('attach')
    expect(parseOrbSelectionActionUrl('orb-selection-action://translate-zh/')).toBe('translate-zh')
    for (const url of [
      'https://example.com/', 'javascript:alert(1)', 'orb-selection-action://delete/',
      'orb-selection-action://attach/?next=1', 'orb-selection-action://attach/#x',
      'orb-selection-action://user@attach/', 'orb-selection-action://attach/other',
    ]) expect(parseOrbSelectionActionUrl(url)).toBeUndefined()
  })

  it('shows only after explicit selection and dispatches only a clicked action', async () => {
    const state = harness()
    expect(state.calls).toEqual([])
    expect(await state.controller.show({ text: 'copied', point: { x: -100, y: 300 } }, state.actions)).toBe('shown')
    expect(state.windows[0]?.visible).toBe(true)
    expect(state.controller.webContentsId).toBe(11)
    expect(state.calls).toEqual([])
    state.windows[0]?.activate('attach')
    expect(state.calls).toEqual(['attach'])
    expect(state.windows[0]?.visible).toBe(false)
    state.windows[0]?.activate('translate-en')
    expect(state.calls).toEqual(['attach'])
  })

  it('hides for NAS, permission loss, task execution, synthetic input, and unsupported Wayland', async () => {
    const state = harness()
    const selection = { text: 'copied', point: { x: 100, y: 200 } }
    await state.controller.show(selection, state.actions)
    state.setTaskRunning(true)
    expect(state.windows[0]?.visible).toBe(false)
    expect(await state.controller.show(selection, state.actions)).toBe('unavailable')
    state.setTaskRunning(false)
    await state.controller.show(selection, state.actions)
    state.setInputActive(true)
    expect(state.windows[0]?.visible).toBe(false)
    state.setInputActive(false)
    await state.controller.show(selection, state.actions)
    state.setLocal(false)
    expect(state.windows[0]?.visible).toBe(false)
    state.setLocal(true)
    state.setPositioned(false)
    expect(await state.controller.show(selection, state.actions)).toBe('unavailable')
    expect(state.windows[0]?.visible).toBe(false)
  })

  it('reuses a window and destroys it once', async () => {
    const state = harness()
    await state.controller.show({ text: 'a', point: { x: 10, y: 10 } }, state.actions)
    await state.controller.show({ text: 'b', point: { x: 20, y: 20 } }, state.actions)
    expect(state.windows).toHaveLength(1)
    state.controller.dispose()
    state.controller.dispose()
    expect(state.windows[0]?.destroyed).toBe(true)
    expect(state.controller.webContentsId).toBeUndefined()
    expect(await state.controller.show({ text: 'c', point: { x: 30, y: 30 } }, state.actions)).toBe('unavailable')
  })

  it('does not show after an in-flight page load loses local authority', async () => {
    let finishLoad: (() => void) | undefined
    let local = true
    let shown = false
    const controller = createOrbSelectionWindowController({
      canShowLocal: () => local,
      supportsPositioning: () => true,
      workAreas: () => [right],
      locale: () => 'en',
      createWindow: () => ({
        webContentsId: 12,
        load: () => new Promise<void>((resolve) => { finishLoad = resolve }),
        setActionHandler() {},
        setBounds() {},
        showInactive() { shown = true },
        hide() { shown = false },
        destroy() {},
        isDestroyed: () => false,
      }),
    })
    const pending = controller.show({ text: 'a', point: { x: 10, y: 10 } }, {
      search: async () => {}, translate: () => {}, attach: () => {},
    })
    local = false
    controller.refreshAuthority()
    finishLoad?.()
    expect(await pending).toBe('unavailable')
    expect(shown).toBe(false)
    controller.dispose()
  })
})
