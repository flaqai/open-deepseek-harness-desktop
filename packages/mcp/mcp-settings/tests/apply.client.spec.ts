import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { RemoteMock } from '@deepseek-ai/dsh-remote-mock'
import { expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

it.each([false, true])('disposes the MCP section and contains a failed Remote mount (%s)', async (failed) => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const release = vi.fn()
  const remote = Object.assign(RemoteMock.create().remote, {
    $mount: vi.fn(() => failed ? Promise.reject(new Error('mount refused')) : Promise.resolve(release)),
    $on: () => () => {},
    $host: { home: undefined, isLoopback: true },
    $stream: () => { throw new Error('This registration test never opens streams') },
  })
  ctx.provide('remote', remote)
  slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  expect(slots.entries('settings.section')).toHaveLength(1)
  for (const id of ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt', 'ko']) {
    expect(locale.hasDictionary('settings.mcp', id), id).toBe(true)
  }
  expect(slots.entries('settings.section')[0]?.options.id).toBe('mcp')
  await fiber.dispose()
  expect(slots.entries('settings.section')).toHaveLength(0)
  expect(release).toHaveBeenCalledTimes(failed ? 0 : 1)
})
