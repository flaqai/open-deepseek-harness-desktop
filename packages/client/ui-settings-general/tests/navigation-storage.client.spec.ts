// @vitest-environment jsdom
/** Navigation persistence through the real registered settings shell and shared form. */
import { expect, vi, onTestFinished } from 'vitest'
import { createClientTest, webApp, type TestClient } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import type { SettingsRootInjected } from '../src/client/shell-contract.ts'
import type { SettingsNavigationLayout } from '../src/types.ts'

const it = createClientTest({ roster: webApp })
const layout: SettingsNavigationLayout = {
  version: 1, groups: [{ id: 'ungrouped', label: '', sectionIds: ['models', 'models', 'missing'] }], hiddenIds: ['missing'],
}

function faceOf(client: TestClient): SettingsRootInjected {
  const entry = client.ctx.slots.entries('sidebar.settings')[0]!
  return (entry.inject as () => SettingsRootInjected)()
}

it('reads legacy order without writing and keeps normalized snapshots stable', async ({ start }) => {
  const client = await start()
  const form = client.ctx.configForms.get<{ sectionOrder: string[]; sectionLayout?: SettingsNavigationLayout | undefined }>('ui-settings-general')
  const snapshot = form.getSnapshot()
  const state: { sectionLayout?: SettingsNavigationLayout } = {}
  const read = vi.spyOn(form, 'getSnapshot').mockImplementation(() => ({
    ...snapshot, status: 'ready', writable: true, value: { sectionOrder: ['models'], sectionLayout: state.sectionLayout },
  }))
  const write = vi.spyOn(form, 'set').mockResolvedValue(true)
  onTestFinished(() => { read.mockRestore(); write.mockRestore() })
  const face = faceOf(client)
  expect(face.hooks.sectionOrder.getSnapshot()).toEqual(['models'])
  expect(face.hooks.sectionLayout.getSnapshot()).toBeUndefined()
  expect(write).not.toHaveBeenCalled()
  state.sectionLayout = layout
  const accepted = face.hooks.sectionLayout.getSnapshot()
  expect(accepted?.groups[0]?.sectionIds).toEqual(['models', 'missing'])
  expect(face.hooks.sectionLayout.getSnapshot()).toBe(accepted)
  await face.setSectionLayout(layout)
  expect(write).toHaveBeenCalledExactlyOnceWith('sectionLayout', accepted)
}, 60_000)

for (const outcome of ['readonly', 'refused', 'throw'] as const) {
  it(`rejects ${outcome} persistence without publishing a draft as accepted`, async ({ start }) => {
    const client = await start()
    const form = client.ctx.configForms.get<{ sectionOrder: string[]; sectionLayout?: SettingsNavigationLayout }>('ui-settings-general')
    const snapshot = form.getSnapshot()
    const read = vi.spyOn(form, 'getSnapshot').mockImplementation(() => ({
      ...snapshot, status: 'ready', writable: outcome !== 'readonly', value: { sectionOrder: ['models'] },
    }))
    const write = vi.spyOn(form, 'set').mockImplementation(async () => {
      if (outcome === 'throw') throw new Error('transport unavailable')
      return false
    })
    onTestFinished(() => { read.mockRestore(); write.mockRestore() })
    const face = faceOf(client)
    await expect(face.setSectionLayout(layout)).rejects.toThrow()
    expect(face.hooks.sectionLayout.getSnapshot()).toBeUndefined()
    expect(write).toHaveBeenCalledTimes(outcome === 'readonly' ? 0 : 1)
  }, 60_000)
}
