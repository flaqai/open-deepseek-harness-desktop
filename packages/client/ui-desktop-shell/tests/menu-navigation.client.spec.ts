import { describe, expect, it, vi } from 'vitest'
import { navigateDesktopMenu } from '../src/client/menu-navigation.ts'

function bench() {
  return { startSession: vi.fn(), open: vi.fn(), hasSection: vi.fn(() => true), general: vi.fn(), unavailable: () => 'Plugin unavailable; install it explicitly in Settings.' }
}
describe('desktop product navigation', () => {
  it('delegates a new conversation to the existing draft-preserving workspace flow', () => {
    const navigation = bench()
    navigateDesktopMenu('new-session', navigation)
    expect(navigation.startSession).toHaveBeenCalledOnce()
    expect(navigation.open).not.toHaveBeenCalled()
  })
  it.each([
    ['market', 'market'], ['plugin-restore', 'plugin-restore'], ['diagnostics', 'diagnostics'],
    ['external-tools', 'external-tools'], ['orb-settings', 'orb'], ['phone', 'pocket'], ['im', 'xmanrui-dsh-im'],
  ])('opens %s through settings navigation', (command, sectionId) => {
    const navigation = bench()
    navigateDesktopMenu(command, navigation)
    expect(navigation.open).toHaveBeenCalledWith({ sectionId })
  })
  it('targets snapshots and queues General panels without executing their operations', () => {
    const navigation = bench()
    navigateDesktopMenu('snapshots', navigation)
    expect(navigation.open).toHaveBeenCalledWith({ sectionId: 'diagnostics', subsectionId: 'snapshots' })
    for (const command of ['updates', 'data-home']) {
      navigateDesktopMenu(command, navigation)
      expect(navigation.general).toHaveBeenCalledWith(command)
      expect(navigation.open).toHaveBeenLastCalledWith({ sectionId: 'general' })
    }
  })
  it('reports absent plugin pages and rejects arbitrary destinations without installing', () => {
    const navigation = bench()
    navigation.hasSection.mockReturnValue(false)
    expect(() =>{  navigateDesktopMenu('market', navigation) }).toThrow('Plugin unavailable')
    expect(() =>{  navigateDesktopMenu('https://example.com', navigation) }).toThrow('Plugin unavailable')
    expect(navigation.open).not.toHaveBeenCalled()
  })
})
