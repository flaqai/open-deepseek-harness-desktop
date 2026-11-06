// @vitest-environment jsdom
/** Workspace failure notices and user-controlled recovery through the production renderer. */
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

const runtimes = new Set<SlotTestRuntime>()
afterEach(async () => {
  cleanup()
  for (const runtime of runtimes) await runtime.dispose()
  runtimes.clear()
  vi.restoreAllMocks()
  localStorage.clear()
})

async function bench(collapsed = false, drawer = false) {
  const runtime = await SlotTestRuntime.create()
  runtimes.add(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  await runtime.mount({
    inject: ['slots'],
    apply(ctx: Context) {
      ctx.provide('shortcuts', { catalog: createSnapshotStore([]) } as never)
      ctx.provide('layout', { toggleSidebar: vi.fn(), selectPanel: vi.fn() } as never)
      ctx.provide('uiWorkspace', { startSession: vi.fn() } as never)
      ctx.provide('locale', locale)
      ctx.effect(() => locale.register('common', { zh: commonZh, en: commonEn }), 'recovery test: common locale')
      ctx.slots.installLocale(locale)
    },
  })
  function Frame({ renderSlot }: PropsRenderSlots<'sidebar'>) {
    return <>
      <aside>{renderSlot('sidebar', { collapsed, width: collapsed ? 56 : 300, drawer })}</aside>
      <main><p>Existing conversation</p><textarea aria-label="Composer" defaultValue="Unsent draft" /></main>
    </>
  }
  await runtime.root.declare({ sidebar: { kind: 'single', scope: 'root' } }, Frame)
  await runtime.mount({ inject: [...inject], apply })
  return { runtime, locale, view: runtime.renderRoot() }
}

async function registerWorkspace(runtime: SlotTestRuntime, render: () => ReactNode) {
  await act(async () => {
    await runtime.mount({ inject: ['slots'], apply(ctx: Context) {
      ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({ name: 'sidebar.workspaces' }, render))
    } })
  })
}

describe('workspace region recovery', () => {
  it('shows an unavailable notice without a fake retry while no workspace browser is registered', async () => {
    const { runtime, view } = await bench()
    expect(view.getByRole('status').textContent).toContain('Workspaces unavailable')
    expect(view.queryByRole('button', { name: 'Retry workspaces' })).toBeNull()
    const composer = view.getByRole('textbox', { name: 'Composer' })
    await registerWorkspace(runtime, () => <div>Workspace browser restored</div>)
    expect(view.getByText('Workspace browser restored')).toBeTruthy()
    expect(view.queryByText('Workspaces unavailable')).toBeNull()
    expect(view.getByRole('textbox', { name: 'Composer' })).toBe(composer)
  })

  it.each([
    ['expanded', false, false],
    ['rail', true, false],
    ['drawer', false, true],
  ] as const)('keeps the %s sidebar and draft usable while retrying only the failed browser', async (_mode, collapsed, drawer) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { runtime, view } = await bench(collapsed, drawer)
    const composer = view.getByRole('textbox', { name: 'Composer' })
    fireEvent.change(composer, { target: { value: 'Draft kept through retry' } })
    localStorage.setItem('recovery-test-marker', 'kept')
    let broken = true
    const renderWorkspace = vi.fn(() => {
      if (broken) throw new Error('workspace render failed')
      return <div>Workspace browser restored</div>
    })
    await registerWorkspace(runtime, renderWorkspace)
    expect(view.getByRole('alert').textContent).toContain('Workspaces could not be displayed.')
    expect(view.getByText('Existing conversation')).toBeTruthy()
    const attempts = renderWorkspace.mock.calls.length
    await act(async () => { await Promise.resolve() })
    expect(renderWorkspace).toHaveBeenCalledTimes(attempts)
    fireEvent.click(view.getByRole('button', { name: 'Retry workspaces' }))
    await waitFor(() => { expect(renderWorkspace.mock.calls.length).toBeGreaterThan(attempts) })
    expect(view.getByRole('button', { name: 'Retry workspaces' })).toBeTruthy()
    broken = false
    fireEvent.click(view.getByRole('button', { name: 'Retry workspaces' }))
    await waitFor(() => { expect(view.getByText('Workspace browser restored')).toBeTruthy() })
    expect(view.queryByRole('alert')).toBeNull()
    expect(view.getByRole('textbox', { name: 'Composer' })).toBe(composer)
    expect((composer as HTMLTextAreaElement).value).toBe('Draft kept through retry')
    expect(localStorage.getItem('recovery-test-marker')).toBe('kept')
    expect(view.getAllByRole('button', { name: 'New session' }).length).toBeGreaterThan(0)
  })
})
