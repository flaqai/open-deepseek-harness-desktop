import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { CustomInstructionsRow } from '../src/client/CustomInstructionsRow.tsx'
import { CustomInstructionsSection } from '../src/client/CustomInstructionsSection.tsx'
import { apply, inject } from '../src/client/index.ts'

describe('custom instructions browser plugin', () => {
  it('provides the trusted editor and registers General plus full-page entry points', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: {
        'settings.general.item': { kind: 'list', scope: 'root' },
        'settings.section': { kind: 'list', scope: 'root' },
        'settings.section.icon': { kind: 'list', scope: 'root', inline: true },
      },
    } as never, () => null)
    ctx.provide('locale', new LocaleRuntime(ctx))
    const scope = {
      getSnapshot: () => ({
        status: 'ready',
        value: { global: { versions: [] }, workspaces: {}, diagnosticExport: { preference: 'ask' } },
        base: undefined, user: undefined, revision: 1, writable: true, mode: 'host',
      }),
      subscribe: () => () => {},
      mutate: vi.fn(async () => true),
      set: vi.fn(async () => true),
      unset: vi.fn(async () => true),
    }
    ctx.provide('configForms', { get: () => scope } as never)
    const open = vi.fn()
    ctx.provide('settingsNavigation', { open } as never)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.general.item')[0]?.component).toBe(CustomInstructionsRow)
    expect(slots.entries('settings.section')[0]?.component).toBe(CustomInstructionsSection)
    expect(slots.entries('settings.section.icon').map(entry => entry.options.id)).toEqual(['custom-instructions'])
    ctx.customInstructions.openGlobal()
    expect(open).toHaveBeenCalledWith({ sectionId: 'custom-instructions', subsectionId: 'global' })
    await fiber.dispose()
    expect(slots.entries('settings.section')).toHaveLength(0)
    expect(slots.entries('settings.section.icon')).toHaveLength(0)
  })
})
