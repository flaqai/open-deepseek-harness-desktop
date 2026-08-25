/** Sandboxed interaction controller for the first-run data-home chooser. */

import { ipcRenderer } from 'electron'

type DataHomeMode = 'imported' | 'reused' | 'fresh'

function isDataHomeMode(value: string | null): value is DataHomeMode {
  return value === 'imported' || value === 'reused' || value === 'fresh'
}

interface DetailCopy {
  title: string
  risk?: string
  location: string
  sharing: string
  plugins: string
  builds: string
}

const zh = {
  windowTitle: '选择数据目录', importTitle: '复制到独立目录', recommended: '推荐',
  importSummary: '保留官方数据副本，之后互不影响。', reuseTitle: '直接复用官方配置',
  reuseSummary: '与官方 dsh 共享设置、凭据、会话和插件。', freshTitle: '全新开始',
  freshSummary: '不导入任何现有数据。', locationLabel: '数据位置', sharingLabel: '共享范围',
  pluginsLabel: '已有插件', buildsLabel: '构建权限', compare: '查看完整对比', cancel: '取消',
  continue: '使用此配置', comparisonTitle: '这三个选项有什么区别？', suitableLabel: '适合谁',
  compareImportLocation: '复制用户数据到桌面版独立目录。', compareReuseLocation: '直接使用官方 ~/.dsh。',
  compareFreshLocation: '创建新的桌面版独立目录。', compareImportSharing: '不共享；复制后互不影响。',
  compareReuseSharing: '共享；两端修改会互相影响。', compareFreshSharing: '不共享任何既有数据。',
  compareImportPlugins: '插件运行时不复制；预置项在新目录核对。', compareReusePlugins: '直接使用官方目录中已有插件。',
  compareFreshPlugins: '从空白 Profile 开始，只安装预置项。', compareImportSuitable: '希望保留数据，同时隔离桌面版的用户。',
  compareReuseSuitable: '希望桌面版与官方 dsh 始终一致的用户。', compareFreshSuitable: '希望完全从零配置的用户。',
  comparisonNote: '同名、npm alias 或同 GitHub 仓库与子路径的插件不会重复安装；allowBuilds 只与已有许可合并，不覆盖显式拒绝。',
  acknowledge: '知道了', helpLabel: '查看三个选项的区别', closeLabel: '关闭',
}

const en: typeof zh = {
  windowTitle: 'Choose data directory', importTitle: 'Copy to an independent directory', recommended: 'Recommended',
  importSummary: 'Keep a copy of official data, then work independently.', reuseTitle: 'Reuse official configuration',
  reuseSummary: 'Share settings, credentials, sessions, and plugins with official dsh.', freshTitle: 'Start fresh',
  freshSummary: 'Do not import any existing data.', locationLabel: 'Data location', sharingLabel: 'Sharing',
  pluginsLabel: 'Existing plugins', buildsLabel: 'Build approvals', compare: 'View full comparison', cancel: 'Cancel',
  continue: 'Use this configuration', comparisonTitle: 'How do these options differ?', suitableLabel: 'Best for',
  compareImportLocation: 'Copy user data into an independent desktop directory.', compareReuseLocation: 'Use official ~/.dsh directly.',
  compareFreshLocation: 'Create a new independent desktop directory.', compareImportSharing: 'Not shared; each side changes independently.',
  compareReuseSharing: 'Shared; changes on either side affect the other.', compareFreshSharing: 'No existing data is shared.',
  compareImportPlugins: 'Plugin runtimes are not copied; presets are reconciled in the new directory.', compareReusePlugins: 'Use plugins already installed in the official home.',
  compareFreshPlugins: 'Start with an empty Profile and install only presets.', compareImportSuitable: 'Keep existing data while isolating the desktop app.',
  compareReuseSuitable: 'Keep the desktop app and official dsh fully aligned.', compareFreshSuitable: 'Configure everything from scratch.',
  comparisonNote: 'Plugins with the same name, npm alias, or GitHub repository and subpath are not installed twice. allowBuilds is merged with existing approvals and never overrides an explicit denial.',
  acknowledge: 'Got it', helpLabel: 'Compare the three options', closeLabel: 'Close',
}

const details: Record<'zh' | 'en', Record<DataHomeMode, DetailCopy>> = {
  zh: {
    imported: {
      title: zh.importTitle,
      location: '复制到桌面版独立数据目录，官方 ~/.dsh 保持不变。',
      sharing: '复制完成后不共享；桌面版与官方 dsh 的后续修改互不影响。',
      plugins: '不复制旧运行时；已有同名或同仓库依赖会被识别，不重复安装。',
      builds: '所需许可与现有 allowBuilds 合并，显式拒绝保持不变。',
    },
    reused: {
      title: zh.reuseTitle,
      risk: '桌面版与官方 dsh 的修改会互相影响，包括凭据、会话和插件。',
      location: '直接使用 ~/.dsh，不创建第二份 Harness 配置。',
      sharing: '共享设置、凭据、会话、Agent 预设、Skills、Profile 和插件。',
      plugins: '保留当前版本；同名、npm alias 或同 GitHub 仓库与子路径不重复安装。',
      builds: '与现有 allowBuilds 取并集，用户明确设置的 false 不会被覆盖。',
    },
    fresh: {
      title: zh.freshTitle,
      location: '创建空白的桌面版独立数据目录。',
      sharing: '不读取或修改官方 ~/.dsh。',
      plugins: '从空白 Profile 开始，只核对桌面版预置插件。',
      builds: '仅加入预置插件经过审核且确实需要的构建许可。',
    },
  },
  en: {
    imported: {
      title: en.importTitle,
      location: 'Copy into the desktop-owned data directory while leaving official ~/.dsh unchanged.',
      sharing: 'Nothing stays shared after copying; later changes remain independent.',
      plugins: 'Old runtimes are not copied; matching package or repository dependencies are adopted without duplication.',
      builds: 'Required entries merge into allowBuilds while explicit denials remain unchanged.',
    },
    reused: {
      title: en.reuseTitle,
      risk: 'Desktop and official dsh changes affect each other, including credentials, sessions, and plugins.',
      location: 'Use ~/.dsh directly without creating a second Harness configuration.',
      sharing: 'Share settings, credentials, sessions, Agent presets, Skills, Profiles, and plugins.',
      plugins: 'Keep current versions; matching names, npm aliases, or GitHub repository subpaths are not installed twice.',
      builds: 'Merge with existing allowBuilds while preserving every explicit false rule.',
    },
    fresh: {
      title: en.freshTitle,
      location: 'Create an empty desktop-owned data directory.',
      sharing: 'Do not read or modify official ~/.dsh.',
      plugins: 'Start from an empty Profile and reconcile only desktop presets.',
      builds: 'Add only reviewed lifecycle approvals required by desktop presets.',
    },
  },
}

function required(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (element === null) throw new Error(`desktop: data-home chooser is missing ${selector}`)
  return element
}

window.addEventListener('DOMContentLoaded', () => {
  const language: 'zh' | 'en' = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const copy = language === 'zh' ? zh : en
  for (const element of document.querySelectorAll<HTMLElement>('[data-copy]')) {
    const key = element.dataset.copy as keyof typeof copy
    element.textContent = copy[key]
  }
  document.title = copy.windowTitle
  const help = required('#help') as HTMLButtonElement
  const close = required('#close-comparison') as HTMLButtonElement
  help.ariaLabel = copy.helpLabel
  close.ariaLabel = copy.closeLabel

  const choices = [...document.querySelectorAll<HTMLButtonElement>('.choice')]
  const overlay = required('#overlay')
  const detailTitle = required('#detail-title')
  const risk = required('#risk')
  const location = required('#location-value')
  const sharing = required('#sharing-value')
  const plugins = required('#plugins-value')
  const builds = required('#builds-value')
  const requestedMode = new URLSearchParams(window.location.search).get('selected')
  let selected: DataHomeMode = isDataHomeMode(requestedMode) ? requestedMode : 'imported'

  const select = (mode: DataHomeMode): void => {
    selected = mode
    for (const choice of choices) choice.ariaChecked = String(choice.dataset.mode === mode)
    const detail = details[language][mode]
    detailTitle.textContent = detail.title
    risk.textContent = detail.risk ?? ''
    risk.hidden = detail.risk === undefined
    location.textContent = detail.location
    sharing.textContent = detail.sharing
    plugins.textContent = detail.plugins
    builds.textContent = detail.builds
  }
  for (const choice of choices) {
    choice.addEventListener('click', () => { select(choice.dataset.mode as DataHomeMode) })
  }

  const showComparison = (): void => {
    overlay.hidden = false
    required('#acknowledge').focus()
  }
  const hideComparison = (): void => {
    overlay.hidden = true
    help.focus()
  }
  help.addEventListener('click', showComparison)
  required('#compare').addEventListener('click', showComparison)
  close.addEventListener('click', hideComparison)
  required('#acknowledge').addEventListener('click', hideComparison)
  overlay.addEventListener('click', (event) => { if (event.target === overlay) hideComparison() })
  required('#continue').addEventListener('click', () => {
    ipcRenderer.send('dsh:data-home:selected', selected)
  })
  required('#cancel').addEventListener('click', () => {
    ipcRenderer.send('dsh:data-home:cancelled')
  })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) hideComparison()
    else if (event.key === 'Escape') ipcRenderer.send('dsh:data-home:cancelled')
    else if (event.key === 'Enter' && overlay.hidden) ipcRenderer.send('dsh:data-home:selected', selected)
  })
  select(selected)
}, { once: true })
