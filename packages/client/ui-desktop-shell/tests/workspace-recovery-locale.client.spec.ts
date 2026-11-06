/** Korean workspace recovery copy resolves through the Desktop language registration. */
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { expect, it } from 'vitest'
import { en, zh } from '../../ui-sidebar/src/client/locales.ts'
import { registerDesktopLanguages } from '../src/client/community-locales.ts'

it('resolves Korean workspace recovery messages while the sidebar owns its primary dictionaries', () => {
  const ctx = new Context()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const primary = locale.register('sidebar', { zh, en })
  const dispose = registerDesktopLanguages(ctx)
  try {
    locale.setLocale('ko')
    const t = locale.bind('sidebar')
    expect(t('workspace.unavailable')).toBe('작업 공간을 사용할 수 없습니다')
    expect(t('workspace.failed')).toBe('작업 공간을 표시하지 못했습니다.')
    expect(t('workspace.retry')).toBe('작업 공간 다시 시도')
  } finally {
    dispose()
    primary()
  }
})
