/** Browser editor and navigation for trusted user-authored custom prompts. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { CUSTOM_INSTRUCTION_MAX_CHARS, CUSTOM_INSTRUCTIONS_SETTINGS_NAMESPACE } from '../types.ts'
import { CustomInstructionsRow } from './CustomInstructionsRow.tsx'
import { CustomInstructionsSection } from './CustomInstructionsSection.tsx'
import { en, zh, type CustomInstructionsLocaleKey } from './locales.ts'
import { customInstructionsAdditionalLocales } from './locales-extra.ts'
import {
  createCustomInstructionsClient,
  CUSTOM_INSTRUCTIONS_SECTION_ID,
  type CustomInstructionsClient,
} from './service.ts'
import type { CustomInstructionSettings } from '../types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    customInstructions: CustomInstructionsClient
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.customInstructions': CustomInstructionsLocaleKey
  }
}

export { CUSTOM_INSTRUCTION_MAX_CHARS, CUSTOM_INSTRUCTIONS_SECTION_ID }
export type { CustomInstructionsClient, CustomInstructionsLocaleKey }

const NS = 'settings.customInstructions'

export const inject = ['slots', 'locale', 'configForms', 'settingsNavigation']

/** Provide the editor service and its General/section surfaces. */
export function apply(ctx: ClientContext): void {
  const scope = ctx.configForms.get<CustomInstructionSettings>(CUSTOM_INSTRUCTIONS_SETTINGS_NAMESPACE)
  const client = createCustomInstructionsClient(scope, ctx.settingsNavigation)
  ctx.provide('customInstructions', client)
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ...customInstructionsAdditionalLocales }), 'custom-instructions: dictionaries')
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: CUSTOM_INSTRUCTIONS_SECTION_ID,
    order: 35,
    locale: NS,
    inject: () => ({ open: () => { client.openGlobal() } }),
  }, CustomInstructionsRow))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: CUSTOM_INSTRUCTIONS_SECTION_ID,
    order: 22,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
    inject: () => ({ customInstructions: client }),
  }, CustomInstructionsSection))
}

export type { CustomInstructionsRowInjected, CustomInstructionsRowProps } from './CustomInstructionsRow.tsx'
export type { CustomInstructionsSectionInjected, CustomInstructionsSectionProps } from './CustomInstructionsSection.tsx'
