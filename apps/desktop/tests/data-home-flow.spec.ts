// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { URL as NodeURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sourceCopyFor } from '../src/locales/data-home-source.ts'

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(), send: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => void>(),
}))
vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: ipc.invoke, send: ipc.send,
    on: (name: string, handler: (...args: unknown[]) => void) => ipc.handlers.set(name, handler),
  },
}))

function button(selector: string): HTMLButtonElement {
  const result = document.querySelector<HTMLButtonElement>(selector)
  if (result === null) throw new Error(selector)
  return result
}
function step(): string | undefined { return document.querySelector<HTMLElement>('#detail-stage')?.dataset.step }
async function mount(locale = 'zh', source = '/official/.dsh', community = '', runtimeSwitch = false): Promise<void> {
  const html = await readFile(new NodeURL('../src/data-home.html', import.meta.url), 'utf8')
  document.documentElement.innerHTML = html.replace(/<!doctype html>/i, '')
  window.history.replaceState({}, '', '/?' + new URLSearchParams({
    locale,
    officialSource: source,
    officialDefaultSource: source,
    officialSourceCandidate: '/official/.dsh',
    officialSourceStatus: source ? 'valid' : 'missing',
    communitySource: community,
    communityDefaultSource: community,
    communitySourceCandidate: '/desktop/community',
    communitySourceStatus: community ? 'valid' : 'missing',
    defaultTarget: '/desktop/dsh-home',
    selected: source || community ? 'imported' : 'fresh',
    selectedSource: source ? 'official' : community ? 'community' : 'official',
    returnToMain: runtimeSwitch ? 'true' : 'false',
    defaultTargetAvailable: runtimeSwitch ? 'false' : 'true',
  }).toString())
  await import('../src/data-home-preload.ts')
  window.dispatchEvent(new Event('DOMContentLoaded'))
}
beforeEach(() => { vi.resetModules(); ipc.invoke.mockReset(); ipc.send.mockReset(); ipc.handlers.clear() })
afterEach(() => {
  document.body.replaceChildren()
  delete document.documentElement.dataset.desktopChooser
})

describe('configuration source and operation flow', () => {
  it('returns to the running client without selecting a new configuration', async () => {
    await mount('zh', '', '/desktop/community/dsh-home', true)
    expect(button('#return-main').hidden).toBe(false)
    button('#return-main').click()
    expect(ipc.send).toHaveBeenCalledExactlyOnceWith('dsh:data-home:cancelled')

    ipc.send.mockClear()
    button('[data-source="fresh"]').click()
    button('#continue').click()
    expect(document.querySelector<HTMLElement>('[data-target="default"]')?.hidden).toBe(true)
    expect(button('#continue').disabled).toBe(true)
    expect(ipc.send).not.toHaveBeenCalled()
  })

  it('initializes the fresh-start details and controls when no source is detected', async () => {
    await mount('zh', '')
    expect(button('#return-main').hidden).toBe(true)
    expect(button('[data-source="fresh"]').ariaChecked).toBe('true')
    expect(document.querySelector('#detail-title')?.textContent).toBe('全新开始')
    expect(document.querySelector('#location-value')?.textContent).not.toBe('')
    button('#continue').click()
    expect(step()).toBe('destination')
  })

  it('shows official and community detection together and selects the detected community source', async () => {
    await mount('zh', '', '/desktop/release/dsh-home')
    expect(document.querySelector('#official-source-status')?.textContent).toContain('未检测到')
    expect(document.querySelector('#community-source-status')?.textContent).toContain('已检测到')
    expect(document.querySelector('#community-source-path')?.textContent).toBe('/desktop/release/dsh-home')
    expect(button('[data-source="community"]').ariaChecked).toBe('true')
    expect(button('#choose-official-source').textContent).toBe(sourceCopyFor('zh').chooseOfficial)
    expect(button('#choose-community-source').textContent).toBe(sourceCopyFor('zh').chooseCommunity)
  })

  it('imports official data without offering direct directory sharing', async () => {
    await mount()
    expect(button('#back').hidden).toBe(true)
    button('#continue').click()
    expect(step()).toBe('plugins')
    button('#continue').click()
    expect(step()).toBe('destination')
    expect(ipc.send).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLElement>('#facts')?.inert).toBe(true)
    expect(button('[data-operation="reused"]').hidden).toBe(true)
    button('#back').click()
    expect(step()).toBe('plugins')
    button('#back').click()
    expect(step()).toBe('details')
  })

  it('requires a verified offline transfer and submits only its opaque selection', async () => {
    await mount()
    button('#continue').click()
    expect(step()).toBe('plugins')
    button('[data-migration="offline"]').click()
    expect(button('#continue').disabled).toBe(true)
    expect(document.querySelector('#portable-error')?.textContent).not.toBe('')

    ipc.invoke.mockResolvedValueOnce({ status: 'cancelled' })
    button('#choose-portable').click()
    await vi.waitFor(() => { expect(button('#choose-portable').disabled).toBe(false) })
    expect(button('#continue').disabled).toBe(true)
    expect(ipc.send).not.toHaveBeenCalled()

    ipc.invoke.mockResolvedValueOnce({ status: 'invalid' })
    button('#choose-portable').click()
    await vi.waitFor(() => { expect(button('#choose-portable').disabled).toBe(false) })
    expect(button('#continue').disabled).toBe(true)

    ipc.invoke.mockResolvedValueOnce({
      status: 'selected', selectionId: '12345678-1234-4234-8234-123456789abc',
      target: { platform: 'win32', architecture: 'x64', osVersion: '10.0.22631' },
    })
    button('#choose-portable').click()
    await vi.waitFor(() => { expect(button('#continue').disabled).toBe(false) })
    expect(document.querySelector('#portable-target')?.textContent).toContain('10.0.22631')
    expect(ipc.invoke).toHaveBeenCalledWith('dsh:data-home:choose-portable')
    button('#continue').click()
    expect(step()).toBe('destination')
    button('#continue').click()
    expect(ipc.send).toHaveBeenCalledExactlyOnceWith('dsh:data-home:selected', {
      mode: 'copied', sourceKind: 'official', source: '/official/.dsh', target: { kind: 'default' },
      pluginMigration: { mode: 'offline', selectionId: '12345678-1234-4234-8234-123456789abc' },
    })
  })

  it('copies a community home through an opaque destination and preserves Back navigation', async () => {
    await mount()
    button('[data-source="community"]').click()
    expect(document.querySelector('#community-source-path')?.textContent).toBe('')
    ipc.invoke.mockResolvedValueOnce({
      status: 'valid', path: '/社区配置/dsh-home', entries: ['settings.yaml'],
      selectionId: '12345678-1234-1234-1234-123456789abc',
    })
    button('#choose-community-source').click()
    await vi.waitFor(() => { expect(button('#choose-community-source').disabled).toBe(false) })
    expect(ipc.invoke).toHaveBeenCalledWith('dsh:data-home:choose-source', 'community')
    button('#continue').click()
    button('[data-operation="imported"]').click()
    button('#continue').click()
    expect(step()).toBe('plugins')
    button('#continue').click()
    expect(step()).toBe('destination')
    button('#back').click()
    expect(step()).toBe('plugins')
    button('#back').click()
    expect(step()).toBe('operation')
    expect(button('[data-operation="imported"]').ariaChecked).toBe('true')
    button('#back').click()
    expect(step()).toBe('details')
    expect(button('#back').hidden).toBe(true)
    button('#continue').click()
    button('#continue').click()
    button('#continue').click()
    ipc.invoke.mockResolvedValueOnce({ status: 'selected', path: '/新 目录', selectionId: 'opaque-selection' })
    button('[data-target="custom"]').click()
    await vi.waitFor(() => { expect(button('#continue').disabled).toBe(false) })
    button('#continue').click()
    expect(ipc.send).toHaveBeenCalledExactlyOnceWith('dsh:data-home:selected', {
      mode: 'copied', sourceKind: 'community', source: '/社区配置/dsh-home',
      sourceSelectionId: '12345678-1234-1234-1234-123456789abc',
      target: { kind: 'custom', selectionId: 'opaque-selection' },
      pluginMigration: { mode: 'online' },
    })
  })

  it('reuses only a validated community source and identifies its source category', async () => {
    await mount('zh', '', '/desktop/community/dsh-home')
    button('#continue').click()
    expect(step()).toBe('operation')
    button('[data-operation="reused"]').click()
    button('#continue').click()
    expect(ipc.send).toHaveBeenCalledExactlyOnceWith('dsh:data-home:selected', {
      mode: 'reused', sourceKind: 'community', source: '/desktop/community/dsh-home',
    })
  })

  it('keeps source paths separate and permits retry after final source validation fails', async () => {
    await mount()
    button('[data-source="community"]').click()
    ipc.invoke.mockResolvedValueOnce({ status: 'valid', path: '/community/dsh-home', entries: ['settings.yaml'] })
    button('#choose-community-source').click()
    await vi.waitFor(() => { expect(button('#choose-community-source').disabled).toBe(false) })
    button('[data-source="official"]').click()
    expect(document.querySelector('#official-source-path')?.textContent).toBe('/official/.dsh')
    button('[data-source="community"]').click()
    expect(document.querySelector('#community-source-path')?.textContent).toBe('/community/dsh-home')
    button('#continue').click()
    button('#continue').click()
    expect(button('#continue').disabled).toBe(true)
    ipc.handlers.get('dsh:data-home:source-error')?.({}, { status: 'invalid', path: '/community/dsh-home' })
    expect(button('#continue').disabled).toBe(false)
    expect(document.querySelector<HTMLElement>('#community-source-error')?.hidden).toBe(false)
    expect(document.querySelector('#community-source-error')?.textContent).toBe(sourceCopyFor('zh').communitySourceInvalid)
  })

  it('does not submit on cancelled or unrelated source selection, and fresh setup needs no source', async () => {
    await mount('en', '')
    button('[data-source="community"]').click()
    ipc.invoke.mockResolvedValueOnce({ status: 'cancelled' })
    button('#continue').click()
    await vi.waitFor(() => { expect(button('#choose-community-source').disabled).toBe(false) })
    expect(step()).toBe('details')
    ipc.invoke.mockResolvedValueOnce({ status: 'invalid', path: '/unrelated' })
    button('#continue').click()
    await vi.waitFor(() => { expect(button('#choose-community-source').disabled).toBe(false) })
    expect(ipc.send).not.toHaveBeenCalled()
    button('[data-source="fresh"]').click()
    button('#continue').click()
    expect(step()).toBe('destination')
    button('#continue').click()
    expect(ipc.send).toHaveBeenCalledExactlyOnceWith('dsh:data-home:selected', { mode: 'fresh', target: { kind: 'default' } })
  })

  it('updates source descriptions, comparison and operation controls when changing language', async () => {
    await mount('zh', '', '/desktop/community/dsh-home')
    button('#continue').click()
    button('#language-trigger').click()
    button('[data-language="de"]').click()
    expect(step()).toBe('operation')
    expect(document.querySelector('[data-copy="importTitle"]')?.textContent).toBe(sourceCopyFor('de').officialTitle)
    expect(document.querySelector('[data-copy="comparisonNote"]')?.textContent).toBe(sourceCopyFor('de').comparisonNote)
    expect(document.querySelector('[data-operation-copy="reuseTitle"]')?.textContent).not.toContain('直接')
  })

  it('changes help content with the formal source, operation and destination steps', async () => {
    await mount('zh', '', '/desktop/community/dsh-home')
    button('#help').click()
    expect(document.querySelector('#comparison-title')?.textContent).toBe('这三个选项有什么区别？')
    expect(document.querySelectorAll('#comparison-head th')).toHaveLength(4)
    expect(document.querySelectorAll('#comparison-body th')[1]?.textContent).toBe('保留范围')
    expect(document.querySelectorAll('#comparison-body tr')[1]?.textContent).toContain('历史对话、设置、凭据、Agent 预设、Skill、插件及插件配置全部保留。')
    expect(document.querySelectorAll('#comparison-body tr')[2]?.textContent).toContain('不复制插件本体')
    expect(document.querySelectorAll('#comparison-body tr')[2]?.textContent).toContain('直接使用所选目录中已有插件')
    button('#acknowledge').click()

    button('#continue').click()
    expect(step()).toBe('operation')
    expect(document.querySelector('[data-operation-copy="importTitle"]')?.textContent).toBe('复制到独立环境')
    expect(document.querySelector('#reuse-operation-summary')?.textContent).toContain('不复制、迁移或转换数据')
    button('[data-operation="reused"]').click()
    expect(document.querySelector<HTMLElement>('#risk')?.hidden).toBe(true)
    expect(document.querySelector('#operation-builds')?.textContent).toContain('不合并或新增权限')
    button('#help').click()
    expect(document.querySelector('#comparison-title')?.textContent).toBe('选择使用方式')
    expect(document.querySelectorAll('#comparison-head th')).toHaveLength(3)
    expect(document.querySelector('#comparison-body')?.textContent).toContain('直接沿用所选配置中的 allowBuilds')
    button('#acknowledge').click()

    button('[data-operation="imported"]').click()
    expect(document.querySelector('#operation-plugins')?.textContent).toContain('插件恢复清单')
    expect(document.querySelector('#operation-builds')?.textContent).toContain('精确 allowBuilds')
    button('#continue').click()
    expect(step()).toBe('plugins')
    button('#help').click()
    expect(document.querySelector('#comparison-title')?.textContent).toContain('插件')
    button('#acknowledge').click()
    button('#continue').click()
    expect(step()).toBe('destination')
    button('#help').click()
    expect(document.querySelector('#comparison-title')?.textContent).toBe('选择配置目录')
    expect(document.querySelectorAll('#comparison-head th')).toHaveLength(3)
  })

  it('keeps full comparison on source categories at every step and returns focus to its trigger', async () => {
    await mount('zh', '', '/desktop/community/dsh-home')
    for (const current of ['details', 'operation', 'plugins', 'destination']) {
      expect(step()).toBe(current)
      button('#compare').click()
      expect(document.querySelectorAll('#comparison-head th')).toHaveLength(4)
      expect(document.querySelector('#comparison-title')?.textContent).toBe('这三个选项有什么区别？')
      const rows = document.querySelectorAll('#comparison-body tr')
      for (const index of [1, 2]) {
        const official = rows[index]?.querySelector('td')?.textContent
        expect(official).not.toContain('直接使用')
        expect(official).not.toBe('')
      }
      expect(rows[1]?.textContent).toContain('Agent 预设')
      expect(rows[2]?.textContent).toContain('联网重新安装')
      button('#acknowledge').click()
      expect(document.activeElement).toBe(button('#compare'))
      expect(step()).toBe(current)
      if (current !== 'destination') button('#continue').click()
    }
  })
})

describe('browser source preview', () => {
  it('replays source selection, help, import destination and localized copy without Electron', async () => {
    const html = await readFile(new NodeURL('../src/data-home.html', import.meta.url), 'utf8')
    const preview = await readFile(new NodeURL('../src/data-home-preview.js', import.meta.url), 'utf8')
    document.documentElement.innerHTML = html.replace(/<!doctype html>/i, '')
    delete document.documentElement.dataset.desktopChooser
    window.history.replaceState({}, '', '/')
    window.eval(preview)

    expect(document.querySelector('#detail-title')?.textContent).toBe('导入官方 DeepSeek Harness 配置')
    expect(document.querySelector('#location-value')?.textContent).toContain('.dsh')
    expect(button('#back').hidden).toBe(true)

    button('#help').click()
    expect(document.querySelector<HTMLElement>('#overlay')?.hidden).toBe(false)
    expect(document.querySelector('.comparison-note')?.textContent).toContain('独立目录')
    button('#acknowledge').click()
    expect(document.querySelector<HTMLElement>('#overlay')?.hidden).toBe(true)

    button('#language-trigger').click()
    button('[data-language="en"]').click()
    expect(document.title).toBe('Choose data directory')
    expect(button('#continue').textContent).toBe('Continue')
    button('#help').click()
    expect(document.querySelector('tbody tr th')?.textContent).toBe('Data location')
    expect(document.querySelector('.comparison-note')?.textContent).toContain('imported')
    button('#close-comparison').click()

    button('#choose-official-source').click()
    expect(document.querySelector('#official-source-status')?.textContent).toContain('Detected')
    button('#continue').click()
    expect(step()).toBe('plugins')
    button('#continue').click()
    expect(step()).toBe('destination')
    expect(button('[data-operation="reused"]').hidden).toBe(true)
    button('#help').click()
    expect(document.querySelector('#comparison-title')?.textContent).toBe('Choose configuration directory')
    expect(document.querySelectorAll('#comparison-head th')).toHaveLength(3)
    button('#acknowledge').click()
    button('#help').click()
    expect(document.querySelector('#comparison-title')?.textContent).toBe('Choose configuration directory')
    expect(document.querySelectorAll('#comparison-head th')).toHaveLength(3)
    button('#acknowledge').click()
    button('#compare').click()
    expect(document.querySelectorAll('#comparison-head th')).toHaveLength(4)
    expect(document.querySelector('#comparison-body')?.textContent).toContain('Agent presets')
    expect(document.querySelector('#comparison-body')?.textContent).toContain('reinstall online')
    expect(document.querySelector('#comparison-body')?.textContent).not.toContain('undefined')
    button('#acknowledge').click()
    expect(document.activeElement).toBe(button('#compare'))
    expect(step()).toBe('destination')
    button('[data-target="custom"]').click()
    expect(button('#continue').disabled).toBe(true)
    button('#choose-target').click()
    expect(document.querySelector('#custom-target-path')?.textContent).toBe('<selected empty folder>')
    expect(button('#continue').disabled).toBe(false)
    button('#continue').click()
    expect(document.querySelector('#detail-title')?.textContent).toBe('Preview complete')
  })

  it('stays inert when the formal Electron preload marker is present', async () => {
    const html = await readFile(new NodeURL('../src/data-home.html', import.meta.url), 'utf8')
    const preview = await readFile(new NodeURL('../src/data-home-preview.js', import.meta.url), 'utf8')
    document.documentElement.innerHTML = html.replace(/<!doctype html>/i, '')
    document.documentElement.dataset.desktopChooser = 'true'
    window.eval(preview)

    expect(document.querySelector('#location-value')?.textContent).toBe('')
    expect(document.querySelectorAll('#language-menu .language-option')).toHaveLength(0)
  })
})
