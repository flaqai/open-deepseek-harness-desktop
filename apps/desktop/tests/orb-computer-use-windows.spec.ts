import { describe, expect, it } from 'vitest'
import {
  createOrbWindowsComputerUsePlatform,
  readOrbWindowsComputerUsePermissions,
  type OrbWindowsComputerUseCommand,
} from '../src/orb-computer-use-windows.ts'

const identity = '2a:101:01db000000000001'
const pixels = Buffer.from(Array.from({ length: 16 }, (_, index) => index)).toString('base64')
const capture = JSON.stringify({
  windowId: identity, appName: 'Editor.exe', windowTitle: 'draft',
  x: -200, y: 100, width: 2, height: 2, bgra: pixels,
})

describe('Windows floating Computer Use platform', () => {
  it('reads interactive desktop availability without requesting a grant', async () => {
    const calls: string[][] = []
    const command: OrbWindowsComputerUseCommand = async (args) => {
      calls.push([...args])
      return '{"screenCapture":true,"inputControl":false}'
    }
    await expect(readOrbWindowsComputerUsePermissions(command)).resolves.toEqual({ screenCapture: true, inputControl: false })
    expect(calls).toEqual([['permissions']])
  })

  it('converts bounded physical pixels into a PNG frame', async () => {
    const platform = createOrbWindowsComputerUsePlatform({ exclude: async () => async () => {} }, async () => capture)
    const frame = await platform.captureFrontmost(new AbortController().signal)
    expect(frame.windowId).toBe(identity)
    expect(frame.bounds).toEqual({ x: -200, y: 100, width: 2, height: 2 })
    expect(Buffer.from(frame.data).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  })

  it('pins process-lifetime HWND identity in each input command and restores overlay on failure', async () => {
    const events: string[] = []
    const calls: string[][] = []
    const command: OrbWindowsComputerUseCommand = async (args) => {
      calls.push([...args])
      events.push(args[0] ?? '')
      if (args[0] === 'capture') return capture
      if (args[0] === 'focus') return JSON.stringify({ windowId: identity })
      if (args[0] === 'click') return '{"ok":true}'
      throw new Error('frontmost window changed')
    }
    const platform = createOrbWindowsComputerUsePlatform({
      async exclude() {
        events.push('hide')
        return async () => { events.push('restore') }
      },
    }, command)
    const signal = new AbortController().signal
    await platform.withOverlayExcluded(() => platform.captureFrontmost(signal), signal)
    await platform.withOverlayExcluded(async () => {
      expect(await platform.frontmostWindowId(signal)).toBe(identity)
      await platform.click({ x: -199, y: 101, button: 'right', count: 2 }, signal)
    }, signal)
    await expect(platform.withOverlayExcluded(() => platform.typeText({
      x: -200, y: 100, text: 'hello 世界', replace: true, submit: false,
    }, signal), signal)).rejects.toThrow('frontmost window changed')
    expect(calls[2]).toEqual(['click', identity, '-199', '101', 'right', '2'])
    expect(calls[3]).toEqual(['type', identity, '-200', '100', Buffer.from('hello 世界').toString('base64'), '1', '0'])
    expect(events).toEqual(['hide', 'capture', 'restore', 'hide', 'focus', 'click', 'restore', 'hide', 'type', 'restore'])
  })

  it('rejects malformed native pixels and clears the earlier target', async () => {
    let calls = 0
    const platform = createOrbWindowsComputerUsePlatform({ exclude: async () => async () => {} }, async () => {
      calls += 1
      return calls === 1 ? capture : JSON.stringify({ ...JSON.parse(capture), bgra: 'bad' })
    })
    const signal = new AbortController().signal
    await platform.captureFrontmost(signal)
    await expect(platform.captureFrontmost(signal)).rejects.toThrow('malformed native pixels')
    await expect(platform.click({ x: 1, y: 1, button: 'left', count: 1 }, signal)).rejects.toThrow('observe before input')
  })
})
