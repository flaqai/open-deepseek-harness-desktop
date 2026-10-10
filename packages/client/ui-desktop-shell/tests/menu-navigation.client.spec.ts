import { describe, expect, it, vi } from 'vitest'
import { navigateDesktopMenu } from '../src/client/menu-navigation.ts'

function bench() {
  return { startSession: vi.fn(), open: vi.fn(), openRemoteControl: vi.fn(), hasSection: vi.fn(() => true), general: vi.fn(), unavailable: () => 'Plugin unavailable; install it explicitly in Settings.' }
}
describe('desktop product navigation', () => {
  it('delegates a new conversation to the existing draft-preserving workspace flow', async () => {
    const navigation = bench()
    await navigateDesktopMenu('new-session', navigation)
    expect(navigation.startSession).toHaveBeenCalledOnce()
    expect(navigation.open).not.toHaveBeenCalled()
  })
  it.each([
    ['market', 'market'], ['plugin-restore', 'plugin-restore'], ['diagnostics', 'diagnostics'],
    ['external-tools', 'external-tools'], ['im', 'xmanrui-dsh-im'],
  ])('opens %s through settings navigation', async (command, sectionId) => {
    const navigation = bench()
    await navigateDesktopMenu(command, navigation)
    expect(navigation.open).toHaveBeenCalledWith({ sectionId })
  })
  it('opens phone control through the Agents Anywhere plugin destination', async () => {
    const navigation = bench()
    await navigateDesktopMenu('phone', navigation)
    expect(navigation.openRemoteControl).toHaveBeenCalledOnce()
    expect(navigation.open).not.toHaveBeenCalled()
  })
  it('targets snapshots and queues General panels without executing their operations', async () => {
    const navigation = bench()
    await navigateDesktopMenu('snapshots', navigation)
    expect(navigation.open).toHaveBeenCalledWith({ sectionId: 'diagnostics', subsectionId: 'snapshots' })
    for (const command of ['updates', 'data-home']) {
      await navigateDesktopMenu(command, navigation)
      expect(navigation.general).toHaveBeenCalledWith(command)
      expect(navigation.open).toHaveBeenLastCalledWith({ sectionId: command === 'updates' ? 'about' : 'general' })
    }
  })
  it('opens About directly without scrolling to or starting an update check', async () => {
    const navigation = bench()
    await navigateDesktopMenu('about', navigation)
    expect(navigation.open).toHaveBeenCalledOnce()
    expect(navigation.open).toHaveBeenCalledWith({ sectionId: 'about' })
    expect(navigation.general).not.toHaveBeenCalled()
  })
  it('reports absent plugin pages and rejects arbitrary destinations without installing', () => {
    const navigation = bench()
    navigation.hasSection.mockReturnValue(false)
    expect(() => { void navigateDesktopMenu('market', navigation) }).toThrow('Plugin unavailable')
    expect(() => { void navigateDesktopMenu('https://example.com', navigation) }).toThrow('Plugin unavailable')
    expect(navigation.open).not.toHaveBeenCalled()
  })
})
