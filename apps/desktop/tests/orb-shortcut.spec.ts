import { describe, expect, it } from 'vitest'
import {
  createOrbShortcutController, ORB_COPIED_SELECTION_ACCELERATOR,
  type OrbShortcutRegistry, type OrbShortcutStatus,
} from '../src/orb-shortcut.ts'

function harness() {
  let local = true
  let callback: (() => void) | undefined
  let registerSucceeds = true
  let invoked = 0
  const registrations: string[] = []
  const unregistrations: string[] = []
  const statuses: OrbShortcutStatus[] = []
  const errors: unknown[] = []
  const registry: OrbShortcutRegistry = {
    register(accelerator, action) {
      registrations.push(accelerator)
      if (!registerSucceeds) return false
      callback = action
      return true
    },
    unregister(accelerator) { unregistrations.push(accelerator); callback = undefined },
  }
  const controller = createOrbShortcutController(registry, {
    canUseLocalSelection: () => local,
    invokeCopiedSelection: () => { invoked++ },
    onStatus: (status) => { statuses.push(status) },
    onTriggerError: (error) => { errors.push(error) },
  })
  return {
    controller, registrations, unregistrations, statuses, errors,
    setLocal(value: boolean) { local = value },
    setRegisterSucceeds(value: boolean) { registerSucceeds = value },
    trigger() { callback?.() },
    get invoked() { return invoked },
  }
}

describe('copied-selection global shortcut', () => {
  it('starts disabled and registers only after the user enables it', () => {
    const state = harness()
    expect(state.registrations).toEqual([])
    expect(state.controller.status()).toEqual({ state: 'disabled' })
    expect(state.controller.setEnabled(true)).toEqual({ state: 'registered', accelerator: ORB_COPIED_SELECTION_ACCELERATOR })
    expect(state.registrations).toEqual([ORB_COPIED_SELECTION_ACCELERATOR])
    state.trigger()
    expect(state.invoked).toBe(1)
    state.controller.setEnabled(true)
    expect(state.registrations).toHaveLength(1)
    state.controller.dispose()
    state.controller.dispose()
    expect(state.unregistrations).toEqual([ORB_COPIED_SELECTION_ACCELERATOR])
  })

  it('releases the OS shortcut for NAS, active tasks, and synthetic input', () => {
    const state = harness()
    state.controller.setEnabled(true)
    state.controller.setTaskRunning(true)
    expect(state.controller.status()).toEqual({ state: 'unavailable', reason: 'task-running' })
    expect(state.unregistrations).toHaveLength(1)
    state.controller.setTaskRunning(false)
    expect(state.registrations).toHaveLength(2)
    state.controller.setInputActive(true)
    expect(state.unregistrations).toHaveLength(2)
    state.controller.setInputActive(false)
    expect(state.registrations).toHaveLength(3)
    state.setLocal(false)
    state.controller.refreshAuthority()
    expect(state.controller.status()).toEqual({ state: 'unavailable', reason: 'local-authority' })
    expect(state.unregistrations).toHaveLength(3)
    state.trigger()
    expect(state.invoked).toBe(0)
  })

  it('reports registration conflicts without unregistering a shortcut owned elsewhere', () => {
    const state = harness()
    state.setRegisterSucceeds(false)
    expect(state.controller.setEnabled(true)).toEqual({ state: 'conflict', accelerator: ORB_COPIED_SELECTION_ACCELERATOR })
    state.controller.dispose()
    expect(state.unregistrations).toEqual([])
  })

  it('guards a stale callback after authority loss even before refresh', () => {
    const state = harness()
    state.controller.setEnabled(true)
    state.setLocal(false)
    state.trigger()
    expect(state.invoked).toBe(0)
    state.controller.refreshAuthority()
    expect(state.unregistrations).toHaveLength(1)
  })

  it('reports an Electron registration exception without claiming ownership', () => {
    const errors: unknown[] = []
    const controller = createOrbShortcutController({
      register() { throw new Error('app is not ready') },
      unregister() { throw new Error('must not unregister') },
    }, {
      canUseLocalSelection: () => true,
      invokeCopiedSelection() {},
      onStatus() {},
      onTriggerError(error) { errors.push(error) },
    })
    expect(controller.setEnabled(true)).toEqual({ state: 'failed' })
    controller.dispose()
    expect(errors).toHaveLength(1)
  })
})
