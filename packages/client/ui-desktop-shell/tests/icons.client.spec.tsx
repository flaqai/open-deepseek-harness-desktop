// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DesktopIconSettings } from '../src/client/DesktopIconSettings.tsx'
import { iconPresentation, type DesktopIconsBridge, type DesktopIconStatus } from '../src/client/icon-protocol.ts'
import { centerIconCrop, clampIconCrop, zoomIconCrop } from '../src/client/icon-crop.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const t = ((key: string) => (en as Record<string, string>)[key] ?? key) as never
function setup(platform = 'darwin') {
  const status: DesktopIconStatus = {
    supported: platform !== 'linux', platform, application: 'data:image/png;base64,AA==', tray: 'data:image/png;base64,AA==',
    applicationCustom: false, trayCustom: false, trayFollowsApplication: true, damaged: false, results: [], canCreateShortcut: platform === 'win32',
  }
  const bridge: DesktopIconsBridge = {
    getStatus: vi.fn(async () => status),
    choose: vi.fn(async () => ({ id: 'opaque-selection', width: 800, height: 600, preview: status.application })),
    discard: vi.fn(async () => {}), apply: vi.fn(async () => status),
    followTray: vi.fn(async (follow: boolean) => ({ ...status, trayFollowsApplication: follow })),
    reset: vi.fn(async () => status), repairShortcuts: vi.fn(async () => status), createShortcut: vi.fn(async () => status),
    onStatus: vi.fn(() => () => {}),
  }
  return { bridge, status }
}
describe('icon settings crop and preview', () => {
  it('shows the transparent tray artwork on an explicit checkerboard preview', async () => {
    const { bridge } = setup()
    render(<DesktopIconSettings bridge={bridge} t={t} />)
    const tray = await screen.findByAltText(en['icons.tray'])
    expect(tray.parentElement?.dataset.background).toBe('transparency')
    expect(screen.getByAltText(en['icons.application']).parentElement?.dataset.background).toBeUndefined()
  })
  it.each(['darwin', 'win32'])('previews %s artwork with the native inset and corner geometry', async (platform) => {
    const { bridge } = setup(platform)
    render(<DesktopIconSettings bridge={bridge} t={t} />)
    fireEvent.click(await screen.findByText('Change image'))
    await screen.findByRole('dialog')
    const previews = screen.getByLabelText(en['icons.crop.preview']).querySelectorAll('img')
    const geometry = iconPresentation(platform, 'application')
    expect(previews).toHaveLength(5)
    for (const image of previews) {
      const clip = image.parentElement!
      expect(clip.style.inset).toBe(`${geometry.inset / 512 * 100}%`)
      expect(parseFloat(clip.style.borderRadius)).toBeCloseTo(geometry.radius / (512 - 2 * geometry.inset) * 100)
    }
    expect(screen.getByText(en['icons.crop.finish'])).toBeDefined()
  })
  it('opens square crop and commits only a selection ID, target and bounded crop', async () => {
    const { bridge } = setup()
    render(<DesktopIconSettings bridge={bridge} t={t} />)
    fireEvent.click(await screen.findByText('Change image'))
    await screen.findByRole('dialog')
    expect(screen.getAllByText('32 / 16 px', { selector: 'span' })).toHaveLength(2)
    expect(bridge.apply).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '2' } })
    fireEvent.click(screen.getByText('Apply icon'))
    await waitFor(() => { expect(bridge.apply).toHaveBeenCalledWith('opaque-selection', 'application', { x: 250, y: 150, size: 300 }) })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })
  it('Escape discards the draft without saving', async () => {
    const { bridge } = setup()
    render(<DesktopIconSettings bridge={bridge} t={t} />)
    fireEvent.click(await screen.findByText('Change image'))
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(bridge.discard).toHaveBeenCalledWith('opaque-selection')
    expect(bridge.apply).not.toHaveBeenCalled()
  })
  it('drags within image bounds and confirms the latest animation-frame position', async () => {
    class TestPointerEvent extends MouseEvent {
      pointerId: number
      constructor(type: string, options: PointerEventInit) { super(type, options); this.pointerId = options.pointerId ?? 1 }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent)
    const { bridge } = setup()
    render(<DesktopIconSettings bridge={bridge} t={t} />)
    fireEvent.click(await screen.findByText('Change image'))
    const crop = await screen.findByRole('group', { name: 'Move the crop with arrow keys' })
    Object.defineProperty(crop, 'setPointerCapture', { value: vi.fn() })
    vi.spyOn(crop, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 300, x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 300, toJSON() {} })
    fireEvent.pointerDown(crop, { pointerId: 1, clientX: 150, clientY: 150, button: 0 })
    fireEvent.pointerMove(crop, { pointerId: 1, clientX: 175, clientY: 150 })
    fireEvent.pointerUp(crop, { pointerId: 1 })
    fireEvent.click(screen.getByText('Apply icon'))
    await waitFor(() => { expect(bridge.apply).toHaveBeenCalledWith('opaque-selection', 'application', { x: 50, y: 0, size: 600 }) })
  })
  it('does not save when the native picker is cancelled and cleans up a late picker result', async () => {
    const { bridge } = setup()
    vi.mocked(bridge.choose).mockResolvedValueOnce(null)
    const view = render(<DesktopIconSettings bridge={bridge} t={t} />)
    fireEvent.click(await screen.findByText('Change image'))
    await waitFor(() => { expect(bridge.choose).toHaveBeenCalledTimes(1) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bridge.apply).not.toHaveBeenCalled()
    let finish: ((value: Awaited<ReturnType<DesktopIconsBridge['choose']>>) => void) | undefined
    vi.mocked(bridge.choose).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    fireEvent.click(screen.getByText('Change image'))
    view.unmount()
    await act(async () => { finish?.({ id: 'late', width: 100, height: 100, preview: '' }) })
    expect(bridge.discard).toHaveBeenCalledWith('late')
  })
  it('supports keyboard move, recenter and low-resolution warnings', async () => {
    const { bridge } = setup()
    render(<DesktopIconSettings bridge={bridge} t={t} />)
    fireEvent.click(await screen.findByText('Change image'))
    const crop = await screen.findByRole('group', { name: 'Move the crop with arrow keys' })
    fireEvent.keyDown(crop, { key: 'ArrowLeft', shiftKey: true })
    fireEvent.change(screen.getByRole('slider'), { target: { value: '2' } })
    expect(screen.getByText(/may look blurry/)).toBeDefined()
    fireEvent.click(screen.getByText('Recenter'))
    fireEvent.click(screen.getByText('Apply icon'))
    await waitFor(() => { expect(bridge.apply).toHaveBeenCalledWith('opaque-selection', 'application', { x: 250, y: 150, size: 300 }) })
  })
  it('allows a separate tray image without changing the application selection', async () => {
    const { bridge } = setup()
    render(<DesktopIconSettings bridge={bridge} t={t} />)
    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(await screen.findByText('Change tray image'))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByText('Apply icon'))
    await waitFor(() => { expect(bridge.apply).toHaveBeenCalledWith('opaque-selection', 'tray', { x: 100, y: 0, size: 600 }) })
  })
  it('retains the dialog and previous preference on failed save', async () => {
    const { bridge } = setup()
    vi.mocked(bridge.apply).mockRejectedValue(new Error('icon.expired'))
    render(<DesktopIconSettings bridge={bridge} t={t} />)
    fireEvent.click(await screen.findByText('Change image'))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByText('Apply icon'))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The selection expired. Choose the image again.')
    expect(screen.getByRole('dialog')).toBeDefined()
  })
  it('exposes independent Windows outcomes and explicit shortcut creation', async () => {
    const { bridge, status } = setup('win32')
    status.results = [{ surface: 'application', status: 'applied' }, { surface: 'desktop', status: 'unavailable' }, { surface: 'taskbar', status: 'repin' }]
    render(<DesktopIconSettings bridge={bridge} t={t} />)
    expect(await screen.findByText(/Could not update; check permissions/)).toBeDefined()
    expect(screen.getByText(/unpin and pin/)).toBeDefined()
    expect(bridge.createShortcut).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Create my desktop shortcut'))
    await waitFor(() => { expect(bridge.createShortcut).toHaveBeenCalledTimes(1) })
  })
  it('hides unsupported Linux and disposes selected pixels on unmount', async () => {
    const { bridge } = setup('linux')
    const first = render(<DesktopIconSettings bridge={bridge} t={t} />)
    await waitFor(() => { expect(screen.queryByText('Application icons')).toBeNull() })
    first.unmount()
    const supported = setup()
    const view = render(<DesktopIconSettings bridge={supported.bridge} t={t} />)
    fireEvent.click(await screen.findByText('Change image'))
    await screen.findByRole('dialog')
    view.unmount()
    expect(supported.bridge.discard).toHaveBeenCalledWith('opaque-selection')
  })
})
describe('square crop geometry', () => {
  it('fits portrait and landscape sources and clamps every edge', () => {
    expect(centerIconCrop(600, 800)).toEqual({ x: 0, y: 100, size: 600 })
    expect(centerIconCrop(800, 600)).toEqual({ x: 100, y: 0, size: 600 })
    expect(clampIconCrop({ x: -100, y: 1000, size: 300 }, 800, 600)).toEqual({ x: 0, y: 300, size: 300 })
    expect(zoomIconCrop(centerIconCrop(800, 600), 800, 600, 2)).toEqual({ x: 250, y: 150, size: 300 })
  })
})
