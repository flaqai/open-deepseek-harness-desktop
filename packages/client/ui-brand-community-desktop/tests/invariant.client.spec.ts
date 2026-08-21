import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as BrandInvariant from '../src/invariant.ts'
import { apply as nodeApply } from '../src/index.ts'

describe('community desktop brand invariant companion', () => {
  it('reserves package ownership and keeps the node half inert', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(BrandInvariant).await()).resolves.toBeDefined()
    expect(() => { nodeApply() }).not.toThrow()
  })
})
