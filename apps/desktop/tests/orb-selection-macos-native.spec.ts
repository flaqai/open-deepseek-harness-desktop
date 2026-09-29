import { describe, expect, it, vi } from 'vitest'
import {
  createOrbMacSelectionMonitorFactory, parseOrbMacSelectionLine, type OrbMacSelectionBinding,
} from '../src/orb-selection-macos-native.ts'

function fakeBinding() {
  let callback: ((line: string) => void) | undefined
  const binding: OrbMacSelectionBinding = {
    start: vi.fn((next) => { callback = next }),
    stop: vi.fn(),
    excludePids: vi.fn(),
  }
  return { binding, emit: (line: string) => { callback?.(line) } }
}

describe('macOS AX-only selection ingress', () => {
  it('accepts only bounded source-attributed selection events', () => {
    const valid = JSON.stringify({ type: 'selection', text: 'selected', x: -240, y: 120, pid: process.pid + 1 })
    expect(parseOrbMacSelectionLine(valid)).toEqual({ text: 'selected', point: { x: -240, y: 120 } })
    for (const event of [
      '{', 'null', '[]', '{}',
      JSON.stringify({ type: 'selection', text: '', x: 1, y: 2, pid: 123 }),
      JSON.stringify({ type: 'selection', text: 'x'.repeat(8193), x: 1, y: 2, pid: 123 }),
      JSON.stringify({ type: 'selection', text: 'x', x: 1, y: 2, pid: process.pid }),
      JSON.stringify({ type: 'selection', text: 'x', x: 1, y: 2, pid: 1.2 }),
      JSON.stringify({ type: 'selection', text: 'x', x: '1', y: 2, pid: 123 }),
      JSON.stringify({ type: 'other', text: 'x', x: 1, y: 2, pid: 123 }),
    ]) expect(parseOrbMacSelectionLine(event)).toBeUndefined()
    expect(parseOrbMacSelectionLine(JSON.stringify({ type: 'ready' }))).toBe('ready')
    expect(parseOrbMacSelectionLine(JSON.stringify({ type: 'untrusted' }))).toBe('untrusted')
  })

  it('starts only on macOS and stops on permission loss', () => {
    const fake = fakeBinding()
    const seen: string[] = []
    const statuses: string[] = []
    expect(createOrbMacSelectionMonitorFactory({ binding: fake.binding, platform: 'linux' })).toBeUndefined()
    const factory = createOrbMacSelectionMonitorFactory({
      binding: fake.binding, platform: 'darwin', onStatus: (status) => { statuses.push(status) },
    })
    const monitor = factory?.((selection) => { seen.push(selection.text) })
    expect(monitor?.active?.()).toBe(true)
    expect(fake.binding.excludePids).toHaveBeenCalledWith(String(process.pid))
    fake.emit(JSON.stringify({ type: 'ready' }))
    fake.emit(JSON.stringify({ type: 'selection', text: 'one', x: 1, y: 2, pid: process.pid + 1 }))
    fake.emit(JSON.stringify({ type: 'untrusted' }))
    expect(monitor?.active?.()).toBe(false)
    fake.emit(JSON.stringify({ type: 'selection', text: 'two', x: 1, y: 2, pid: process.pid + 1 }))
    monitor?.stop()
    expect(statuses).toEqual(['ready', 'untrusted'])
    expect(seen).toEqual(['one'])
    expect(fake.binding.stop).toHaveBeenCalledTimes(1)
  })

  it('never reports ready or presents text when Accessibility is refused at start', () => {
    const fake = fakeBinding()
    const status = vi.fn()
    const selection = vi.fn()
    const factory = createOrbMacSelectionMonitorFactory({ binding: fake.binding, platform: 'darwin', onStatus: status })
    const monitor = factory?.(selection)
    expect(monitor?.active?.()).toBe(true)
    fake.emit(JSON.stringify({ type: 'untrusted' }))
    expect(monitor?.active?.()).toBe(false)
    fake.emit(JSON.stringify({ type: 'ready' }))
    fake.emit(JSON.stringify({ type: 'selection', text: 'secret', x: 1, y: 2, pid: process.pid + 1 }))
    monitor?.stop()
    expect(status).toHaveBeenCalledExactlyOnceWith('untrusted')
    expect(selection).not.toHaveBeenCalled()
    expect(fake.binding.stop).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the native monitor cannot start', () => {
    const fake = fakeBinding()
    vi.mocked(fake.binding.start).mockImplementation(() => { throw new Error('native unavailable') })
    const status = vi.fn()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const factory = createOrbMacSelectionMonitorFactory({ binding: fake.binding, platform: 'darwin', onStatus: status })
      expect(factory?.(() => undefined)).toBeUndefined()
      expect(status).toHaveBeenCalledWith('failed')
      expect(fake.binding.stop).toHaveBeenCalledTimes(1)
    } finally {
      warning.mockRestore()
    }
  })
})
