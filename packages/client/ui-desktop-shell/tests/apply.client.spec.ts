// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { DesktopPreferencesRow } from '../src/client/DesktopPreferencesRow.tsx'
import { ReleaseFooterAction } from '../src/client/ReleaseFooterAction.tsx'

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).deepSeekHarnessDesktop
})

function installBridge(): void {
  ;(globalThis as unknown as Record<string, unknown>).deepSeekHarnessDesktop = {
    shell: {
      getCapabilities: vi.fn(() => Promise.resolve({
        platform: 'darwin', packaged: true, launchAtLoginAvailable: true, sourceUpdateAvailable: false,
      })),
      getPreferences: vi.fn(() => Promise.resolve({
        closeBehavior: 'tray', notificationsEnabled: true, launchAtLoginEnabled: false,
      })),
      updatePreferences: vi.fn(), onPreferences: vi.fn(() => () => {}), openLog: vi.fn(),
    },
    releases: {
      getStatus: vi.fn(() => Promise.resolve({ phase: 'current', currentVersion: '0.1.0' })),
      check: vi.fn(), onStatus: vi.fn(() => () => {}), openDownload: vi.fn(),
    },
  }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'settings.general.item': { kind: 'list', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  return { ctx, slots }
}

describe('ui-desktop-shell apply', () => {
  it('registers nothing in an ordinary browser', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.general.item')).toEqual([])
    expect(b.slots.entries('sidebar.footer.action')).toEqual([])
    await fiber.dispose()
  })

  it('registers desktop preferences and Release badge when the bridge exists', async () => {
    installBridge()
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.general.item')[0]?.component).toBe(DesktopPreferencesRow)
    const release = b.slots.entries('sidebar.footer.action')[0]
    expect(release?.component).toBe(ReleaseFooterAction)
    expect(release?.options).toMatchObject({ id: 'desktop-release', order: -1000 })
    await fiber.dispose()
    expect(b.slots.entries('settings.general.item')).toEqual([])
    expect(b.slots.entries('sidebar.footer.action')).toEqual([])
  })
})
