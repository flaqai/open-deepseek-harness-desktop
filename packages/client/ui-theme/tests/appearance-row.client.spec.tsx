// @vitest-environment jsdom
/** AppearanceRow behavior: palette and background cards mirror persisted
 * state; a curated palette may also restore its paired background. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { AppearanceRow } from '../src/client/AppearanceRow.tsx'
import type { AppearanceRowComponentProps } from '../src/client/AppearanceRow.tsx'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'
import type { ThemePreference } from '../src/client/index.ts'

afterEach(cleanup)

const COPY: Record<string, string> = {
  'appearance.title': 'Appearance',
  'appearance.skins': 'Theme skins',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'appearance.ocean': 'Deep Ocean',
  'appearance.moonlight': 'Moon Whale',
  'appearance.bubble': 'Bubble Cove',
  'appearance.inspirationCollage': 'Idea Collage',
  'appearance.starlight': 'Starlight',
  'appearance.pirate': 'Pirate Horizon',
  'appearance.shinobi': 'Shinobi Ember',
  'appearance.rift': 'Rift Arena',
  'appearance.collection': '11 skins',
  'background.title': 'Chat background',
  'background.description': 'Choose a background.',
  'background.none': 'Solid',
  'background.deepOcean': 'Ocean Whale',
  'background.moonWhale': 'Moon Whale',
  'background.bubbleWhale': 'Bubble Whale',
  'background.ideaCollage': 'Idea Collage',
  'background.animeStarlight': 'Anime Coder',
  'background.pirateHorizon': 'Pirate Horizon',
  'background.shinobiEmber': 'Shinobi Ember',
  'background.riftArena': 'Rift Arena',
  'background.upload': 'Upload background',
}

/** Empty global standard-kit hooks (the row reads neither). */
function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

function mount(preference: ThemePreference = 'system') {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createAppearanceRowStore().create()
  store.actions.sync(preference, 'none', 0)
  const setTheme = vi.fn()
  const setBackground = vi.fn()
  const setCustomBackground = vi.fn(async () => {})
  const props: AppearanceRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setTheme,
    setBackground,
    setCustomBackground,
  }
  render(<AppearanceRow {...props} />)
  return { store, setTheme, setBackground }
}

const pressed = (name: RegExp): string | null =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('AppearanceRow', () => {
  it('renders eleven skins and original background choices with persisted selections', () => {
    mount('dark')
    expect(screen.getByText('Theme skins')).toBeDefined()
    expect(screen.getByText('11 skins')).toBeDefined()
    expect(screen.getAllByRole('button', { pressed: false }).length).toBeGreaterThan(3)
    expect(pressed(/Dark/)).toBe('true')
    expect(pressed(/Light/)).toBe('false')
    expect(pressed(/System/)).toBe('false')
  })

  it('click drives setTheme; selection follows the store mirror, not the click echo', () => {
    const b = mount('dark')
    fireEvent.click(screen.getByRole('button', { name: /Light/ }))
    expect(b.setTheme).toHaveBeenCalledWith('light')
    // No store write yet: selection is unchanged.
    expect(pressed(/Dark/)).toBe('true')
    act(() => { b.store.actions.sync('light', 'none', 1) })
    expect(pressed(/Light/)).toBe('true')
    expect(pressed(/Dark/)).toBe('false')
  })

  it('selects a shipped chat background through the theme service', () => {
    const mounted = mount()
    fireEvent.click(screen.getByRole('button', { name: /Ocean Whale/ }))
    expect(mounted.setBackground).toHaveBeenCalledWith('deep-ocean')
  })

  it('selects the original anime-style background without using franchise assets', () => {
    const mounted = mount()
    fireEvent.click(screen.getByRole('button', { name: /Anime Coder/ }))
    expect(mounted.setBackground).toHaveBeenCalledWith('anime-starlight')
  })

  it('selects the inspiration collage palette and its paired background in one gesture', () => {
    const mounted = mount('inspiration-collage')
    fireEvent.click(screen.getAllByRole('button', { name: /Idea Collage/ })[0]!)
    expect(mounted.setTheme).toHaveBeenCalledWith('inspiration-collage')
    expect(mounted.setBackground).toHaveBeenCalledWith('idea-collage')
  })
})
