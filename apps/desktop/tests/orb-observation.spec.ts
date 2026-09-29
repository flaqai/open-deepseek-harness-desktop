import { describe, expect, it } from 'vitest'
import {
  createOrbObservationController, orbObservationSegments,
  type OrbObservationRect, type OrbObservationWindow,
} from '../src/orb-observation.ts'

const leftDisplay: OrbObservationRect = { x: -1000, y: 0, width: 1000, height: 800 }
const rightDisplay: OrbObservationRect = { x: 0, y: 0, width: 1200, height: 800 }

describe('floating observation indicator', () => {
  it('clips each edge against both displays without shifting the observed region', () => {
    const segments = orbObservationSegments(
      { x: -100, y: 100, width: 300, height: 200 },
      [leftDisplay, rightDisplay],
    )
    expect(segments.filter(segment => segment.edge === 'top')).toEqual([
      { edge: 'top', x: -100, y: 100, width: 100, height: 6 },
      { edge: 'top', x: 0, y: 100, width: 200, height: 6 },
    ])
    expect(segments.every(segment => segment.width > 0 && segment.height > 0)).toBe(true)
  })

  it('rejects invalid geometry and ignores disconnected displays', () => {
    expect(orbObservationSegments({ x: 0, y: 0, width: Infinity, height: 3 }, [rightDisplay])).toEqual([])
    expect(orbObservationSegments({ x: 2000, y: 0, width: 100, height: 100 }, [rightDisplay])).toEqual([])
  })

  it('is click-through by adapter, hides on NAS or permission revocation, and reuses windows', () => {
    let local = true
    let display: readonly OrbObservationRect[] = [rightDisplay]
    const created: Array<OrbObservationWindow & { visible: boolean; destroyed: boolean; bounds: OrbObservationRect | undefined }> = []
    const controller = createOrbObservationController({
      canObserveLocal: () => local,
      workAreas: () => display,
      toLogicalRegion: value => value,
      createWindow() {
        const window = {
          visible: false,
          destroyed: false,
          bounds: undefined as OrbObservationRect | undefined,
          webContentsId: created.length + 1,
          setBounds(bounds: OrbObservationRect) { this.bounds = bounds },
          showInactive() { this.visible = true },
          hide() { this.visible = false },
          destroy() { this.destroyed = true },
          isDestroyed() { return this.destroyed },
        }
        created.push(window)
        return window
      },
    })
    expect(controller.show({ x: 30, y: 40, width: 200, height: 100 })).toBe('shown')
    expect(created).toHaveLength(4)
    expect(controller.windowIds()).toEqual([1, 2, 3, 4])
    display = []
    controller.refresh()
    expect(created.every(window => !window.visible)).toBe(true)
    display = [rightDisplay]
    controller.refresh()
    expect(created.every(window => !window.visible)).toBe(true)
    expect(controller.show({ x: 30, y: 40, width: 200, height: 100 })).toBe('shown')
    expect(created.every(window => window.visible)).toBe(true)
    expect(created).toHaveLength(4)
    local = false
    controller.refresh()
    expect(created.every(window => !window.visible)).toBe(true)
    local = true
    controller.refresh()
    expect(created.every(window => !window.visible)).toBe(true)
    local = false
    expect(controller.show({ x: 30, y: 40, width: 200, height: 100 })).toBe('unavailable')
    controller.dispose()
    expect(created.every(window => window.destroyed)).toBe(true)
    expect(controller.windowIds()).toEqual([])
  })
})
