import { describe, expect, it } from 'vitest'
import {
  createOrbMacComputerUsePlatform,
  readOrbMacComputerUsePermissions,
  type OrbMacComputerUseCommand,
} from '../src/orb-computer-use-macos.ts'

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]).toString('base64')
const capture = JSON.stringify({ windowId: '42', appName: 'Editor', x: 100, y: 200, width: 500, height: 300, png })

describe('macOS floating Computer Use platform', () => {
  it('reads both native permission grants without requesting them', async () => {
    const calls: string[][] = []
    const command: OrbMacComputerUseCommand = async (args) => {
      calls.push([...args])
      return '{"screenCapture":true,"inputControl":false}'
    }
    await expect(readOrbMacComputerUsePermissions(command)).resolves.toEqual({ screenCapture: true, inputControl: false })
    expect(calls).toEqual([['permissions']])
  })

  it('restores the overlay after capture and failed native input', async () => {
    const events: string[] = []
    const command: OrbMacComputerUseCommand = async (args) => {
      events.push(args[0] ?? '')
      if (args[0] === 'capture') return capture
      if (args[0] === 'focus') return '{"windowId":"42"}'
      throw new Error('frontmost window changed')
    }
    const platform = createOrbMacComputerUsePlatform({
      async exclude() {
        events.push('hide')
        return async () => { events.push('restore') }
      },
    }, command)
    const signal = new AbortController().signal
    await platform.withOverlayExcluded(() => platform.captureFrontmost(signal), signal)
    await expect(platform.withOverlayExcluded(async () => {
      expect(await platform.frontmostWindowId(signal)).toBe('42')
      await platform.click({ x: 200, y: 250, button: 'left', count: 1 }, signal)
    }, signal)).rejects.toThrow('frontmost window changed')
    expect(events).toEqual(['hide', 'capture', 'restore', 'hide', 'focus', 'click', 'restore'])
  })

  it('pins the captured native window ID in each input command', async () => {
    const calls: string[][] = []
    const command: OrbMacComputerUseCommand = async (args) => {
      calls.push([...args])
      if (args[0] === 'capture') return capture
      if (args[0] === 'focus') return '{"windowId":"42"}'
      return '{"ok":true}'
    }
    const platform = createOrbMacComputerUsePlatform({ exclude: async () => async () => {} }, command)
    const signal = new AbortController().signal
    await platform.captureFrontmost(signal)
    await platform.click({ x: 200, y: 250, button: 'right', count: 2 }, signal)
    await platform.typeText({ x: 150, y: 220, text: 'hello 世界', replace: true, submit: false }, signal)
    expect(calls[1]).toEqual(['click', '42', '200', '250', 'right', '2'])
    expect(calls[2]).toEqual(['type', '42', '150', '220', Buffer.from('hello 世界').toString('base64'), '1', '0'])
  })

  it('rejects malformed native screenshot data and does not retain its identity', async () => {
    const command: OrbMacComputerUseCommand = async (args) => {
      if (args[0] === 'capture') return JSON.stringify({ ...JSON.parse(capture), png: 'not png' })
      return '{"ok":true}'
    }
    const platform = createOrbMacComputerUsePlatform({ exclude: async () => async () => {} }, command)
    const signal = new AbortController().signal
    await expect(platform.captureFrontmost(signal)).rejects.toThrow('malformed native screenshot')
    await expect(platform.click({ x: 1, y: 1, button: 'left', count: 1 }, signal)).rejects.toThrow('observe before input')
  })
})
