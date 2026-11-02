/** Host settings-shell preferences stored in the active Profile. */
import type {} from '@deepseek-ai/dsh-settings'
import type { Volatile, Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SettingsNavigationLayout } from './types.ts'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Last acknowledged welcome notice version. */
  welcomeNoticeVersion: Volatile<string | undefined>
  /** User-selected vertical order of settings sections. */
  sectionOrder: Volatile<string[]>
  /** Grouped navigation preference; absent values retain the legacy ordering. */
  sectionLayout: Volatile<SettingsNavigationLayout | undefined>
}

/** Live welcome preference. */
export const Config = z.object({
  welcomeNoticeVersion: z.string().volatile(),
  sectionOrder: z.array(z.string()).default([]).volatile(),
  sectionLayout: z.union([z.const(undefined), z.object({
    version: z.const(1),
    groups: z.array(z.object({
      id: z.string(), label: z.string(), sectionIds: z.array(z.string()),
      hidden: z.union([z.const(undefined), z.boolean()]),
      collapsed: z.union([z.const(undefined), z.boolean()]),
    })), hiddenIds: z.array(z.string()),
  }), z.object({
    version: z.const(2),
    nodes: z.array(z.union([
      z.object({ kind: z.const('section'), id: z.string() }),
      z.object({ kind: z.const('group'), id: z.string(), label: z.string(), sectionIds: z.array(z.string()),
        hidden: z.union([z.const(undefined), z.boolean()]), collapsed: z.union([z.const(undefined), z.boolean()]),
      }),
    ])), hiddenIds: z.array(z.string()),
  })]).volatile(),
})

/** Keep the shell's navigation and welcome fields on its own form only. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
