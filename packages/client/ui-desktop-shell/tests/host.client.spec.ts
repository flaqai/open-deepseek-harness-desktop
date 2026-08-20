import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('desktop shell host entry', () => {
  it('exports a Cordis-compatible plugin entry', () => {
    expect(apply).toBeTypeOf('function')
    expect(apply()).toBeUndefined()
  })
})
