import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Welcome } from '../src/client/WelcomePage.tsx'
import { resolveDesktopLocale } from '../src/locale.ts'
import type { WelcomeApi } from '../src/welcome-api.ts'

function api(locale: string): WelcomeApi {
  return {
    ...resolveDesktopLocale(locale),
    takeNotice: async () => undefined,
    startSignIn: async () => { throw new Error('not called during render') },
    cancelSignIn: async () => { throw new Error('not called during render') },
    copySignInLink: async () => { throw new Error('not called during render') },
    saveApiKey: async () => ({ ok: false }),
    skip: async () => undefined,
    onAccountState: () => () => undefined,
  }
}

describe('official native welcome renderer', () => {
  it('renders both sign-in and API-key choices in Chinese', () => {
    const html = renderToStaticMarkup(createElement(Welcome, { api: api('zh-CN') }))
    expect(html).toContain('添加 API Key')
    expect(html).toContain('登录')
    expect(html).toContain('保存并继续')
    expect(html).toContain('稍后配置')
  })

  it('keeps the key field password-masked', () => {
    const html = renderToStaticMarkup(createElement(Welcome, { api: api('en') }))
    expect(html).toContain('type="password"')
    expect(html).toContain('Save and continue')
  })
})
