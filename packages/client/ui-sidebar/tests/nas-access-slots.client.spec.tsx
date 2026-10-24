// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { SidebarRoot } from '../src/client/SidebarRoot.tsx'
import type { SidebarRootComponentProps } from '../src/client/contract/slots.ts'
import { en } from '../src/client/locales.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'

afterEach(cleanup)

describe('NAS role permissions through the Slot renderer', () => {
  it.each(['admin', 'user', 'readonly'] as const)('binds the %s create grant to the actual sidebar and reacts to revocation', async (role) => {
    const allowed = createSnapshotStore(role !== 'readonly')
    const runtime = await SlotTestRuntime.create({ access: { source: () => allowed, global: () => allowed } })
    onTestFinished(() => runtime.dispose())
    const createSession = vi.fn()
    const t: SidebarRootComponentProps['t'] = makeTranslate(en, commonEn)
    function Frame(props: PropsRuntime<'root'>) {
      return <SidebarRoot {...props} collapsed={false} width={300} presentation="column" dismiss={() => {}}
        useSessionStatus={selector => selector(new Map())} usePanels={selector => selector([])}
        useShortcuts={selector => selector([])} selectPanel={() => {}}
        useEntryPins={selector => selector([])} useEntryActions={selector => selector(false)}
        setPinned={() => {}} trackEntryClick={() => {}}
        startSession={createSession} toggleSidebar={() => {}} renderSlot={() => null} t={t} />
    }
    runtime.slots.register({ name: 'root' }, Frame)
    runtime.renderRoot()
    const buttons = screen.getAllByRole<HTMLButtonElement>('button', { name: en['session.new.label'] })
    const target = buttons.at(-1)
    if (target === undefined) throw new Error('Expected the sidebar New session button')
    expect(buttons.every(button => button.disabled)).toBe(role === 'readonly')
    fireEvent.click(target)
    expect(createSession).toHaveBeenCalledTimes(role === 'readonly' ? 0 : 1)
    act(() => { allowed.set(false) })
    expect(buttons.every(button => button.disabled)).toBe(true)
    fireEvent.click(target)
    expect(createSession).toHaveBeenCalledTimes(role === 'readonly' ? 0 : 1)
  })
})
