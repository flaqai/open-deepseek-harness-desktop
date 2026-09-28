import { describe, expect, it } from 'vitest'
import {
  createOrbLinuxComputerUsePlatform,
  readOrbLinuxComputerUsePermissions,
  type OrbLinuxComputerUseCommand,
  type OrbLinuxSession,
} from '../src/orb-computer-use-linux.ts'

const x11: OrbLinuxSession = { platform: 'linux', sessionType: 'x11', display: ':0' }
const wayland: OrbLinuxSession = { platform: 'linux', sessionType: 'wayland', display: ':0' }
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]).toString('base64')
const capture = JSON.stringify({ windowId: '42:100:200:500:300', appName: 'Editor', x: 100, y: 200, width: 500, height: 300, png })
const signal = new AbortController().signal

describe('Linux floating Computer Use platform', () => {
  it('reports GNOME Wayland unsupported even with an Xwayland DISPLAY', async () => {
    const command: OrbLinuxComputerUseCommand = async () => { throw new Error('must not probe') }
    await expect(readOrbLinuxComputerUsePermissions(command, signal, wayland)).resolves.toEqual({
      screenCapture: false, inputControl: false, status: 'unsupported-wayland',
    })
    expect(() => createOrbLinuxComputerUsePlatform({ exclude: async () => async () => {} }, command, wayland))
      .toThrow('Linux X11 native platform is unavailable')
  })

  it('probes X11 capture and XTEST rights without requesting permissions', async () => {
    const calls: string[][] = []
    const command: OrbLinuxComputerUseCommand = async (args) => {
      calls.push([...args])
      return '{"screenCapture":true,"inputControl":true}'
    }
    await expect(readOrbLinuxComputerUsePermissions(command, signal, x11)).resolves.toEqual({
      screenCapture: true, inputControl: true, status: 'available',
    })
    expect(calls).toEqual([['permissions']])
  })

  it('fails closed when X11 cannot be probed', async () => {
    const command: OrbLinuxComputerUseCommand = async () => { throw new Error('display unavailable') }
    await expect(readOrbLinuxComputerUsePermissions(command, signal, x11)).resolves.toEqual({
      screenCapture: false, inputControl: false, status: 'unavailable-x11',
    })
  })

  it('restores overlay after capture and failed input while pinning captured identity', async () => {
    const events: string[] = []
    const calls: string[][] = []
    const command: OrbLinuxComputerUseCommand = async (args) => {
      events.push(args[0] ?? '')
      calls.push([...args])
      if (args[0] === 'capture') return capture
      if (args[0] === 'focus') return '{"windowId":"42:100:200:500:300"}'
      throw new Error('frontmost window changed')
    }
    const platform = createOrbLinuxComputerUsePlatform({
      async exclude() {
        events.push('hide')
        return async () => { events.push('restore') }
      },
    }, command, x11)
    await platform.withOverlayExcluded(() => platform.captureFrontmost(signal), signal)
    await expect(platform.withOverlayExcluded(async () => {
      expect(await platform.frontmostWindowId(signal)).toBe('42:100:200:500:300')
      await platform.click({ x: 200, y: 250, button: 'left', count: 1 }, signal)
    }, signal)).rejects.toThrow('frontmost window changed')
    expect(events).toEqual(['hide', 'capture', 'restore', 'hide', 'focus', 'click', 'restore'])
    expect(calls[2]).toEqual(['click', '42:100:200:500:300', '200', '250', 'left', '1'])
  })

  it('passes bounded text to the native helper and rejects malformed capture', async () => {
    const calls: string[][] = []
    const command: OrbLinuxComputerUseCommand = async (args) => {
      calls.push([...args])
      if (args[0] === 'capture') return capture
      return '{"ok":true}'
    }
    const platform = createOrbLinuxComputerUsePlatform({ exclude: async () => async () => {} }, command, x11)
    await platform.captureFrontmost(signal)
    await platform.typeText({ x: 150, y: 220, text: 'hello', replace: true, submit: false }, signal)
    expect(calls[1]).toEqual(['type', '42:100:200:500:300', '150', '220', Buffer.from('hello').toString('base64'), '1', '0'])

    const malformed = createOrbLinuxComputerUsePlatform({ exclude: async () => async () => {} },
      async () => JSON.stringify({ ...JSON.parse(capture), png: 'not png' }), x11)
    await expect(malformed.captureFrontmost(signal)).rejects.toThrow('malformed native screenshot')
    await expect(malformed.click({ x: 1, y: 1, button: 'left', count: 1 }, signal)).rejects.toThrow('observe before input')
  })
})
