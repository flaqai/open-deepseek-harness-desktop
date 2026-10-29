/** Onboarding state uses live Config fields. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished } from 'vitest'
import * as HostPlugin from '../src/index.ts'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import * as General from '../src/index.ts'

it('validates and updates onboarding preferences without remounting', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const configuration = await liveConfig(ctx, General)
  await configuration.update({ welcomeNoticeVersion: 'v1' })
  expect(plainConfig(configuration.fiber.effectiveConfig)).toMatchObject({ welcomeNoticeVersion: 'v1' })
  expect(configuration.entry.fiber).toBe(configuration.fiber)
})

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(HostPlugin)))

it('keeps grouped navigation absent for legacy preferences and writes it atomically', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const configuration = await liveConfig(ctx, General)
  expect(plainConfig(configuration.fiber.effectiveConfig)).toHaveProperty('sectionLayout', undefined)
  const sectionLayout = { version: 1, groups: [{ id: 'ungrouped', label: '', sectionIds: ['models'] }], hiddenIds: ['models'] }
  await configuration.update({ sectionOrder: ['models'], sectionLayout })
  expect(plainConfig(configuration.fiber.effectiveConfig)).toMatchObject({ sectionOrder: ['models'], sectionLayout })
})
