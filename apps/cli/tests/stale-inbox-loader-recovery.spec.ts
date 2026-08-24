import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { describe, expect, it, vi } from 'vitest'
import {
  quarantineDuplicateSingletonLoaderEntries,
  quarantineStaleInBoxLoaderEntries,
} from '../src/profile-boot.ts'

const bundle: PatchOptions[] = [{ insert: [{ id: 'shipped', name: '@deepseek-ai/dsh-client-ui-shipped' }] }]

describe('quarantineStaleInBoxLoaderEntries', () => {
  it('temporarily disables a missing in-box module introduced by a user patch', () => {
    const resolveModule = vi.fn((name: string) => {
      if (name === '@deepseek-ai/dsh-client-ui-retired') throw new Error('module not found')
    })

    expect(quarantineStaleInBoxLoaderEntries(bundle, [{ insert: [
      { id: 'retired-ui', name: '@deepseek-ai/dsh-client-ui-retired' },
    ] }], '/profile', resolveModule)).toEqual([{ id: 'retired-ui', disabled: true }])
    expect(resolveModule).toHaveBeenCalledWith('@deepseek-ai/dsh-client-ui-retired')
  })

  it('does not hide a missing shipped row or a third-party plugin', () => {
    const resolveModule = vi.fn(() => { throw new Error('module not found') })

    expect(quarantineStaleInBoxLoaderEntries(bundle, [{ insert: [
      { id: 'third-party', name: 'example-plugin' },
    ] }], '/profile', resolveModule)).toEqual([])
    expect(resolveModule).not.toHaveBeenCalled()

    expect(quarantineStaleInBoxLoaderEntries(bundle, [], '/profile', resolveModule)).toEqual([])
  })

  it('does not disable a user entry when its in-box package resolves', () => {
    const resolveModule = vi.fn()

    expect(quarantineStaleInBoxLoaderEntries(bundle, [{ insert: [
      { id: 'current-ui', name: '@deepseek-ai/dsh-client-ui-current' },
    ] }], '/profile', resolveModule)).toEqual([])
  })
})

describe('quarantineDuplicateSingletonLoaderEntries', () => {
  it('keeps the first Better Sidebar mount and disables a legacy duplicate', () => {
    expect(quarantineDuplicateSingletonLoaderEntries([
      [{ insert: [{ id: 'better-sidebar', name: 'dsh-better-sidebar' }] }],
      [{ insert: [{ id: 'web-ui-better-sidebar', name: 'dsh-better-sidebar' }] }],
    ])).toEqual([{ id: 'web-ui-better-sidebar', disabled: true }])
  })

  it('also handles the reverse bundle order without touching unrelated duplicates', () => {
    expect(quarantineDuplicateSingletonLoaderEntries([
      [{ insert: [
        { id: 'web-ui-better-sidebar', name: 'dsh-better-sidebar' },
        { id: 'first-generic', name: 'generic-plugin' },
      ] }],
      [{ insert: [
        { id: 'better-sidebar', name: 'dsh-better-sidebar' },
        { id: 'second-generic', name: 'generic-plugin' },
      ] }],
    ])).toEqual([{ id: 'better-sidebar', disabled: true }])
  })

  it('ignores an explicitly disabled duplicate', () => {
    expect(quarantineDuplicateSingletonLoaderEntries([[{ insert: [
      { id: 'first', name: 'dsh-better-sidebar' },
      { id: 'disabled', name: 'dsh-better-sidebar', disabled: true },
    ] }]])).toEqual([])
  })
})
