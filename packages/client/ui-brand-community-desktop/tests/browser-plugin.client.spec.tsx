// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommunityBrandMark, CommunityBrandName } from '../src/client/Brand.tsx'
import { apply, inject } from '../src/client/index.ts'

afterEach(() => { cleanup(); vi.unstubAllEnvs() })

const HOLES = ['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark'] as const

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  return { ctx, slots }
}

describe('community desktop browser-brand plugin', () => {
  it('fills all brand slots only for the community desktop profile', async () => {
    expect(inject).toEqual(['slots'])
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'community-desktop')
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(1)
    await fiber.dispose()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)

    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const official = await bench()
    await official.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(official.slots.entries(hole)).toHaveLength(0)
  })

  it('renders the community wordmark and requested mark presentation', () => {
    const name = render(<CommunityBrandName />)
    expect(name.container.querySelector('svg')).toBeTruthy()
    name.unmount()
    const mark = render(<CommunityBrandMark size={34} className="hero-mark" />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('34')
    expect(mark.container.querySelector('svg')?.getAttribute('class')).toBe('hero-mark')
  })
})
