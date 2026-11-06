// @vitest-environment jsdom
/**
 * Integration against the real ui-slots SlotCore through a passthrough host:
 * registrations go through the real register() (options form, children
 * declaration), and the outlets ride the real subscribe/getVersion/entries/
 * isLive APIs — microtask-batched notifications, mutation-stable entry
 * references (the cache axis), and ledger-fed stale bindings are the
 * real-core semantics the fake-host suite cannot vouch for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import {
  SlotCore, StaleAuthorizationError, type PropsRenderSlots, type SlotRendererHost,
  type SlotScopeAdapter, type StandardSourceBinding,
} from '@deepseek-ai/dsh-client-ui-slots'
import { createSlotRenderer } from '../src/client/scoped-slots.tsx'

afterEach(cleanup)

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    // No 'root' merge: the aggregate client program already carries runtime's
    // authoritative 'root' declaration (a private merge would TS2717-collide);
    // only this suite's own test keys merge here.
    'spec.single': { kind: 'single'; scope: 'root'; owner: { label?: string } }
    'spec.list': { kind: 'list'; scope: 'root' }
    'spec.keyed': { kind: 'keyed'; scope: 'root' }
  }
}

type FrameSlots = PropsRenderSlots<'spec.single' | 'spec.list' | 'spec.keyed'>

/** Passthrough host over the real core (store/session seats unused here). */
function hostOver(core: SlotCore): SlotRendererHost {
  const absentBinding: StandardSourceBinding = {
    key: undefined,
    hooks: {},
    keyedHooks: {},
    props: {},
  }
  const bindingSource = {
    getSnapshot: () => absentBinding,
    subscribe: () => () => {},
  }
  const sessionAdapter: SlotScopeAdapter = {
    current: bindingSource,
    bindingSource: () => bindingSource,
  }
  return {
    subscribe: (key, fn) => core.subscribe(key, fn),
    getVersion: key => core.getVersion(key),
    entriesOf: key => core.entries(key),
    entriesOfSlot: key => core.entriesOfSlot(key),
    reportEntryError: (key, entry, error, info) => { core.reportEntryError(key, entry, error, info) },
    retryEntry: (key, entry) => core.retryEntry(key, entry),
    reportFactoryError: (name, definition, error) => { core.reportFactoryError(name, definition, error) },
    specOf: key => core.specDynamic(key),
    isLive: entry => core.isLive(entry),
    storeOf: () => undefined,
    factoryStoreOf: () => undefined,
    retainFactoryOccurrence: () => () => {},
    subscribeFactory: (name, fn) => core.subscribeFactory(name, fn),
    getFactoryVersion: name => core.factoryVersion(name),
    factoryOf: name => core.factory(name),
    isFactoryLive: definition => core.isFactoryLive(definition),
    root: bindingSource,
    scopeRevision: { getSnapshot: () => 0, subscribe: () => () => {} },
    scope: () => sessionAdapter,
  }
}

/** Register the root frame (declaring both child keys) and mount the renderer. */
function mountFrame(core: SlotCore, body: (renderSlot: FrameSlots['renderSlot']) => React.ReactNode) {
  const dispose = core.register({
    name: 'root',
    children: {
      'spec.single': { kind: 'single', scope: 'root' },
      'spec.list': { kind: 'list', scope: 'root' },
      'spec.keyed': { kind: 'keyed', scope: 'root' },
    },
  }, (props: FrameSlots) => <>{body(props.renderSlot)}</>)
  const view = render(<>{createSlotRenderer().renderRoot(hostOver(core), {})}</>)
  return { view, dispose }
}

describe('createSlotRenderer over the real SlotCore', () => {
  it.each(['spec.list', 'spec.keyed'] as const)('recovers only the requested %s cell and preserves the priority of failed candidates', async (key) => {
    const core = new SlotCore()
    let recovered = false
    const otherAttempts = vi.fn()
    const register = (cell: string, body: () => ReactNode, priority = 0) => key === 'spec.list'
      ? core.register({ name: key, id: cell, priority }, body)
      : core.register({ name: key, key: cell, priority }, body)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { view } = mountFrame(core, renderSlot => <>
        {renderSlot(key, {}, { only: 'first', entryKey: 'first', errorFallback: ({ retry }) => <button onClick={retry}>Retry first</button> })}
        {renderSlot(key, {}, { only: 'second', entryKey: 'second', errorFallback: ({ retry }) => <button onClick={retry}>Retry second</button> })}
      </>)
      await act(async () => {
        register('first', () => {
          if (!recovered) throw new Error('primary failed')
          return <b>primary recovered</b>
        })
        register('first', () => { throw new Error('shadow failed') }, 10)
        register('second', () => {
          otherAttempts()
          throw new Error('other cell failed')
        })
      })
      expect(view.getByRole('button', { name: 'Retry first' })).toBeTruthy()
      const otherCount = otherAttempts.mock.calls.length
      recovered = true
      await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Retry first' })) })
      expect(view.getByText('primary recovered')).toBeTruthy()
      expect(view.getByRole('button', { name: 'Retry second' })).toBeTruthy()
      expect(otherAttempts).toHaveBeenCalledTimes(otherCount)
      expect(view.queryByRole('button', { name: 'Retry first' })).toBeNull()
    } finally { error.mockRestore() }
  })

  it.each(['render', 'inject'])('offers explicit recovery after %s fails without remounting siblings or retrying automatically', async (phase) => {
    const core = new SlotCore()
    let broken = true
    const mounted = vi.fn()
    const rendered = vi.fn()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { view } = mountFrame(core, renderSlot => <>
        {renderSlot('spec.single', {}, {
          fallback: <i>not loaded</i>,
          errorFallback: ({ retry }) => <button onClick={retry}>Retry workspace</button>,
        })}
        {renderSlot('spec.list', {})}
      </>)
      expect(view.container.textContent).toBe('not loaded')
      await act(async () => {
        core.register({ name: 'spec.single', inject: () => {
          if (phase === 'inject' && broken) throw new Error('transient workspace injection failure')
          return {}
        } }, () => {
          rendered()
          if (phase === 'render' && broken) throw new Error('transient workspace failure')
          return <b>workspace recovered</b>
        })
        core.register({ name: 'spec.list', id: 'navigation' }, () => {
          useEffect(() => { mounted() }, [])
          return <span>navigation</span>
        })
      })
      expect(view.getByRole('button', { name: 'Retry workspace' })).toBeTruthy()
      expect(view.container.querySelector('[data-slot-error="spec.single"]')).not.toBeNull()
      const attempts = rendered.mock.calls.length
      await act(async () => {})
      expect(rendered).toHaveBeenCalledTimes(attempts)
      await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Retry workspace' })) })
      expect(view.getByRole('button', { name: 'Retry workspace' })).toBeTruthy()
      broken = false
      await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Retry workspace' })) })
      expect(view.container.textContent).toBe('workspace recoverednavigation')
      expect(view.container.querySelector('[data-slot-error]')).toBeNull()
      expect(mounted).toHaveBeenCalledOnce()
    } finally { error.mockRestore() }
  })

  it('renders registrations live through real microtask batching: register, dispose back to fallback', async () => {
    const core = new SlotCore()
    const { view } = mountFrame(core, renderSlot =>
      renderSlot('spec.single', {}, { fallback: <i>none</i> }))
    expect(view.container.textContent).toBe('none')
    let dispose = () => {}
    // The real core batches subscriber notification per microtask: async act.
    await act(async () => {
      dispose = core.register({ name: 'spec.single' }, ({ label }: { label?: string }) => <b>{label ?? 'on'}</b>)
    })
    expect(view.container.textContent).toBe('on')
    await act(async () => { dispose(); dispose() })   // disposer is idempotent in the real core
    expect(view.container.textContent).toBe('none')
  })

  it('coalesces same-tick mutations into one notification (uSES pairing stays consistent)', async () => {
    const core = new SlotCore()
    const notified = vi.fn()
    core.subscribe('spec.list', notified)
    const { view } = mountFrame(core, renderSlot => renderSlot('spec.list', {}))
    await act(async () => {
      core.register({ name: 'spec.list', id: 'two', order: 2 }, () => <span>2</span>)
      core.register({ name: 'spec.list', id: 'one', order: 1 }, () => <span>1</span>)
    })
    expect(notified).toHaveBeenCalledTimes(1)   // two same-tick mutations, one batch
    expect(view.container.textContent).toBe('12')
  })

  it('passes owner props through and keeps sibling entries() references stable across mutations', async () => {
    const core = new SlotCore()
    core.register({ name: 'root', children: {
      'spec.single': { kind: 'single', scope: 'root' },
      'spec.list': { kind: 'list', scope: 'root' },
      'spec.keyed': { kind: 'keyed', scope: 'root' },
    } }, (props: FrameSlots) => <>
      {props.renderSlot('spec.single', { label: 'owner' })}
      {props.renderSlot('spec.list', {})}
    </>)
    core.register({ name: 'spec.single' }, ({ label }: { label?: string }) => <b>{label}</b>)
    const view = render(<>{createSlotRenderer().renderRoot(hostOver(core), {})}</>)
    expect(view.container.textContent).toBe('owner')
    // A mutation on the sibling key leaves this key's entries() reference
    // untouched (real-core stability the inject/renderSlot caches key on).
    const before = core.entries('spec.single')
    await act(async () => { core.register({ name: 'spec.list', id: 'l' }, () => <span>L</span>) })
    expect(core.entries('spec.single')).toBe(before)
    expect(view.container.textContent).toBe('ownerL')
  })

  it('feeds stale bindings from the real ledger: a disposed registration throws off isLive', () => {
    const core = new SlotCore()
    let captured: FrameSlots['renderSlot'] | undefined
    const { view, dispose } = mountFrame(core, (renderSlot) => {
      captured = renderSlot
      return null
    })
    expect(captured!('spec.single', {})).not.toBeUndefined()   // live binding renders
    // Unmount before disposing: an empty 'root' makes a LIVE root outlet
    // rethrow boot-order (covered in the fake-host suite); the scenario here
    // is a retained closure outliving both tree and registration.
    view.unmount()
    dispose()
    expect(() => captured!('spec.single', {})).toThrow(StaleAuthorizationError)
  })
})
