import { expect, it } from 'vitest'
import ko from '../src/client/community-translations/ko.ts'
import { en as en0 } from '../../ui-approval/src/client/locales.ts'
import { en as en1 } from '../../ui-chat/src/client/locale.ts'
import { en as en2 } from '../../ui-conversation/src/client/locales.ts'
import { en as en3 } from '../../ui-model-selection/src/client/locales.ts'
import { en as en4 } from '../../ui-plugin-manager/src/client/locales.ts'
import { en as en5 } from '../../ui-settings-account/src/client/locales.ts'
import { en as en6 } from '../../ui-settings-models/src/client/locales.ts'
import { en as en7 } from '../../ui-settings-web-search/src/client/locales.ts'
import { en as en8 } from '../../ui-theme/src/client/locales.ts'
import { en as en9 } from '../../ui-trajectory/src/client/locales.ts'
import { en as en10 } from '../../ui-workspace/src/client/locales.ts'
import { en as en11 } from '../../../experimental/client-ui-agent-team/src/client/locales.ts'
import { en as en12 } from '../../../session-query/session-log-export/src/client/locales.ts'

it('keeps every community settings label translated in Korean with matching format arguments', () => {
  const contracts = [
    { namespace: 'approval', en: en0,
      keys: ['explanation', 'command.show'] },
    { namespace: 'chat', en: en1,
      keys: ['localImage.checking', 'localImage.unavailable', 'localImage.open', 'localImage.reveal'] },
    { namespace: 'conversation', en: en2,
      keys: ['session.actions.copy', 'session.actions.remove', 'session.actions.cancel', 'session.actions.working', 'session.actions.speaker.user', 'session.actions.speaker.assistant', 'session.actions.remove.title', 'session.actions.remove.description', 'session.actions.remove.confirm'] },
    { namespace: 'model', en: en3,
      keys: ['search.label', 'empty.search', 'blocked.composer'] },
    { namespace: 'pluginManager', en: en4,
      keys: ['accessDenied'] },
    { namespace: 'settings.account', en: en5,
      keys: ['contactUsSignedOut'] },
    { namespace: 'settings.models', en: en6,
      keys: ['sessionLogUploadTitle', 'sessionLogUploadDescription', 'providerSettingsUnavailable', 'onboardingDefault', 'onboardingCustomHint', 'setup.start', 'setup.step.models', 'setup.step.phone', 'setup.step.messages', 'setup.step.codex', 'setup.step.ready', 'setup.title', 'setup.description', 'setup.close', 'setup.language', 'setup.models.title', 'setup.models.description', 'setup.phone.title', 'setup.phone.description', 'setup.im.title', 'setup.im.description', 'setup.codex.title', 'setup.codex.description', 'setup.configure', 'setup.connect', 'setup.reconfigure', 'setup.skip', 'setup.skipAll', 'setup.optional', 'setup.skipped', 'setup.completed', 'setup.progress', 'setup.success', 'setup.successDescription', 'setup.ready', 'setup.readyDescription', 'setup.experience', 'setup.starting', 'setup.saveError'] },
    { namespace: 'settings.webSearch', en: en7,
      keys: ['searchApiPrivacy', 'searchApiProviderChange'] },
    { namespace: 'settings.theme', en: en8,
      keys: ['appearance.skins', 'appearance.ocean', 'appearance.moonlight', 'appearance.bubble', 'appearance.inspirationCollage', 'appearance.starlight', 'appearance.pirate', 'appearance.shinobi', 'appearance.rift', 'appearance.collection', 'background.title', 'background.description', 'background.none', 'background.deepOcean', 'background.moonWhale', 'background.bubbleWhale', 'background.ideaCollage', 'background.animeStarlight', 'background.pirateHorizon', 'background.shinobiEmber', 'background.riftArena', 'background.custom', 'background.upload', 'background.replace', 'background.unsupported', 'background.tooLarge', 'background.failed', 'fontSize.title', 'fontSize.description'] },
    { namespace: 'trajectory', en: en9,
      keys: ['summary.title', 'summary.source', 'summary.turns', 'summary.tools', 'summary.failures', 'summary.running', 'summary.recorded'] },
    { namespace: 'workspace', en: en10,
      keys: ['customInstructions.workspace'] },
    { namespace: 'agent-team', en: en11,
      keys: ['onboardingLocation', 'onboardingDismiss', 'useNow', 'useUnavailable', 'composerHint', 'promptDraft'] },
    { namespace: 'session-log-download', en: en12,
      keys: ['dialog.privacyTitle', 'dialog.privacyDescription', 'dialog.includeCustomInstructions', 'dialog.rememberChoice', 'dialog.includeRememberWarning', 'dialog.export', 'dialog.cancel'] },
  ]
  for (const contract of contracts) {
    for (const key of contract.keys) {
      const original = (contract.en as Record<string, string>)[key]
      const translated = ko[contract.namespace]?.[key]
      expect(translated, `${contract.namespace}.${key}`).toBeDefined()
      expect(translated, `${contract.namespace}.${key}`).not.toBe(original)
      expect(translated?.match(/\{[\w.]+\}/gu)?.sort() ?? [])
        .toEqual(original?.match(/\{[\w.]+\}/gu)?.sort() ?? [])
    }
  }
})
