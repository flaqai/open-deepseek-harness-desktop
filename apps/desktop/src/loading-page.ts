/** Interactive startup and recovery workspace installed by the Desktop preload. */

import type { IpcRenderer } from 'electron'
import type {
  DesktopDataHomeSelectionResult,
  DesktopDataHomeStatus,
  DesktopDataHomeSwitchRequest,
  DesktopDataHomeSwitchResult,
} from './desktop-data-home.ts'
import type { PluginSnapshotRestoreSnapshot, PluginSnapshotSummary } from './plugin-snapshot-manager.ts'
import type { RecoveryPluginInventory, RecoveryPluginSource, RecoveryPluginSummary } from './recovery-plugins.ts'
import { desktopDictionary } from './desktop-locale.ts'
import { parseDesktopStartupProgress, type DesktopStartupProgress, type DesktopStartupStage } from './startup-progress.ts'

type RecoveryPanel = 'plugins' | 'snapshots' | 'directory' | 'diagnostics'

/** Delay before the loading page reveals the slow-start details and log action. */
export const STARTUP_SLOW_PROGRESS_DELAY_MS = 40_000

function element<T extends Element>(selector: string, narrow?: (value: Element) => value is T): T {
  const result = document.querySelector(selector)
  if (result === null || (narrow !== undefined && !narrow(result))) {
    throw new Error(`desktop: loading page is missing ${selector}`)
  }
  return result as T
}

/** Install startup progress and the four peer recovery tools on loading.html. */
export function installLoadingPage(ipcRenderer: IpcRenderer): void {
  if (!location.pathname.endsWith('/loading.html')) return
  const query = new URLSearchParams(location.search)
  const requestedLocale = query.get('locale') ?? navigator.languages
  const copy = desktopDictionary(requestedLocale, { zh: chineseCopy, en: englishCopy })
  const title = element<HTMLElement>('#title')
  const description = element<HTMLElement>('#description')
  const progress = element<HTMLElement>('#progress')
  const progressBar = element<HTMLElement>('#progress-bar')
  const progressTask = element<HTMLElement>('#progress-task')
  const progressPercent = element<HTMLElement>('#progress-percent')
  const recoveryWorkspace = element<HTMLElement>('#recovery-workspace')
  const recoveryHome = element<HTMLElement>('#recovery-home')
  const recoveryDetail = element<HTMLElement>('#recovery-detail')
  const toggleDetails = element<HTMLButtonElement>('#toggle-details')
  const failureDetails = element<HTMLElement>('#failure-details')
  const failureMessage = element<HTMLElement>('#failure-message')
  const logPath = element<HTMLElement>('#log-path')
  const slow = element<HTMLElement>('#slow')
  const slowMessage = element<HTMLElement>('#slow-message')
  const openSlowLog = element<HTMLButtonElement>('#open-slow-log')
  const retry = element<HTMLButtonElement>('#retry')
  const exitButton = element<HTMLButtonElement>('#exit')
  const failed = query.get('state') === 'failed'
  const shutdown = query.get('mode') === 'shutdown'
  let currentProgress: DesktopStartupProgress | undefined

  const progressText = (snapshot: DesktopStartupProgress): string => {
    const operation = snapshot.detail === undefined ? undefined : copy.operations[snapshot.detail]
    if (operation !== undefined) return operation
    if (snapshot.detail === undefined) return copy.stages[snapshot.stage]
    return `${copy.stages[snapshot.stage]} · ${snapshot.detail}`
  }
  const renderProgress = (snapshot: DesktopStartupProgress): void => {
    currentProgress = snapshot
    progressBar.style.width = `${snapshot.progress}%`
    progressPercent.textContent = `${snapshot.progress}%`
    progressTask.textContent = progressText(snapshot)
    progress.setAttribute('aria-valuenow', String(snapshot.progress))
    progress.setAttribute('aria-valuetext', progressTask.textContent)
  }
  const initial = parseDesktopStartupProgress({
    stage: query.get('stage'), progress: Number(query.get('progress')),
    detail: query.get('detail') ?? undefined,
  })
  if (initial !== undefined) renderProgress(initial)
  const progressListener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
    const snapshot = parseDesktopStartupProgress(value)
    if (snapshot !== undefined) renderProgress(snapshot)
  }
  if (!failed) {
    ipcRenderer.on('dsh:startup-progress', progressListener)
    window.addEventListener('unload', () => {
      ipcRenderer.removeListener('dsh:startup-progress', progressListener)
    }, { once: true })
    void ipcRenderer.invoke('dsh:desktop:startup-progress:get').then((value: unknown) => {
      const snapshot = parseDesktopStartupProgress(value)
      if (snapshot !== undefined) renderProgress(snapshot)
    }, () => {
      // The query snapshot remains usable when navigation wins this IPC race.
    })
  }
  const openLog = (): void => { void ipcRenderer.invoke('dsh:desktop:log:open') }
  openSlowLog.textContent = copy.logs
  openSlowLog.addEventListener('click', openLog)

  if (!failed) {
    title.textContent = shutdown ? copy.shutdownTitle : copy.startupTitle
    description.textContent = shutdown ? copy.shutdownDescription : copy.startupDescription
    let slowTicker: ReturnType<typeof setInterval> | undefined
    const showSlowProgress = (): void => {
      const snapshot = currentProgress
      if (snapshot === undefined) slowMessage.textContent = copy.slow
      else {
        const now = Date.now()
        const elapsed = Math.max(0, Math.floor((now - (snapshot.startedAt ?? now)) / 1_000))
        const remaining = snapshot.deadlineAt === undefined
          ? undefined : Math.max(0, Math.ceil((snapshot.deadlineAt - now) / 1_000))
        slowMessage.textContent = copy.slowDetail(progressText(snapshot), elapsed, remaining)
      }
      slow.hidden = false
    }
    const slowTimer = setTimeout(() => {
      showSlowProgress()
      slowTicker = setInterval(showSlowProgress, 1_000)
    }, STARTUP_SLOW_PROGRESS_DELAY_MS)
    window.addEventListener('unload', () => {
      clearTimeout(slowTimer)
      if (slowTicker !== undefined) clearInterval(slowTicker)
    }, { once: true })
    return
  }

  document.body.classList.add('recovery')
  title.textContent = shutdown ? copy.shutdownFailedTitle : copy.recoveryTitle
  description.textContent = shutdown ? copy.shutdownFailedDescription : copy.recoveryDescription
  progressTask.textContent = shutdown ? copy.cleanupBlocked : copy.paused
  progress.setAttribute('aria-valuetext', shutdown ? copy.cleanupBlocked : copy.paused)
  toggleDetails.hidden = false
  toggleDetails.textContent = copy.viewDetails
  failureMessage.textContent = query.get('message') ?? copy.recoveryDescription
  logPath.textContent = `${copy.logLabel}${query.get('logPath') ?? ''}`
  toggleDetails.addEventListener('click', () => {
    failureDetails.hidden = !failureDetails.hidden
    toggleDetails.textContent = failureDetails.hidden ? copy.viewDetails : copy.hideDetails
  })
  if (shutdown) {
    slow.hidden = false
    slowMessage.textContent = copy.shutdownFailedHint
    retry.textContent = copy.retryCleanup
    exitButton.hidden = true
    const footerHint = element<HTMLElement>('#footer-hint')
    footerHint.textContent = copy.shutdownFailedHint
    recoveryWorkspace.hidden = false
    element<HTMLElement>('#recovery-home').hidden = true
    element<HTMLElement>('#recovery-detail').hidden = true
    retry.addEventListener('click', () => {
      retry.disabled = true
      void ipcRenderer.invoke('dsh:desktop:shutdown:retry').finally(() => { retry.disabled = false })
    })
    return
  }
  recoveryWorkspace.hidden = false
  localizeRecoveryWorkspace(copy)

  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab')]
  const panels = [...document.querySelectorAll<HTMLElement>('.panel')]
  const openPanel = (name: RecoveryPanel): void => {
    recoveryHome.hidden = true
    recoveryDetail.hidden = false
    for (const tab of tabs) {
      const active = tab.dataset.panel === name
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
    }
    for (const panel of panels) panel.hidden = panel.id !== `panel-${name}`
    if (name === 'plugins') void loadPlugins()
  }
  for (const card of document.querySelectorAll<HTMLButtonElement>('[data-open-panel]')) {
    card.addEventListener('click', () => { openPanel(card.dataset.openPanel as RecoveryPanel) })
  }
  for (const tab of tabs) tab.addEventListener('click', () => { openPanel(tab.dataset.panel as RecoveryPanel) })

  const pluginLoading = element<HTMLElement>('#plugin-loading')
  const pluginTable = element<HTMLElement>('#plugin-table')
  const pluginRows = element<HTMLElement>('#plugin-rows')
  const pluginEmpty = element<HTMLElement>('#plugin-empty')
  const protectedComponents = element<HTMLElement>('#protected-components')
  const pluginStatus = element<HTMLElement>('#plugin-status')
  let pluginsLoaded = false
  async function loadPlugins(force = false): Promise<void> {
    if (pluginsLoaded && !force) return
    pluginLoading.hidden = false
    pluginLoading.textContent = copy.pluginLoading
    pluginTable.hidden = true
    pluginEmpty.hidden = true
    pluginStatus.hidden = true
    try {
      const inventory = await ipcRenderer.invoke('dsh:desktop:recovery-plugins:list') as RecoveryPluginInventory
      renderPlugins(inventory)
      pluginsLoaded = true
    } catch (error) {
      pluginLoading.textContent = `${copy.pluginLoadFailed}: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  const renderPlugins = (inventory: RecoveryPluginInventory): void => {
    pluginLoading.hidden = true
    pluginRows.replaceChildren(...inventory.plugins.map(plugin => pluginRow(plugin)))
    pluginTable.hidden = inventory.plugins.length === 0
    pluginEmpty.hidden = inventory.plugins.length !== 0
    protectedComponents.hidden = inventory.protectedCount === 0
    protectedComponents.textContent = copy.protectedComponents(inventory.protectedCount)
  }
  const pluginRow = (plugin: RecoveryPluginSummary): HTMLElement => {
    const row = document.createElement('div')
    row.className = 'plugin-row'
    const name = document.createElement('span')
    name.className = 'plugin-name'
    name.textContent = plugin.packageName
    const version = document.createElement('span')
    version.className = 'plugin-version'
    version.textContent = plugin.version ?? '—'
    const status = document.createElement('span')
    status.className = `plugin-status${plugin.status === 'attention' ? ' attention' : ''}`
    status.textContent = plugin.status === 'attention'
      ? copy.pluginAttention(plugin.diagnosticCode)
      : copy.pluginSource(plugin.source)
    const remove = document.createElement('button')
    remove.className = 'plugin-remove'
    remove.type = 'button'
    remove.textContent = copy.uninstall
    remove.setAttribute('aria-label', `${copy.uninstall} ${plugin.packageName}`)
    remove.addEventListener('click', () => {
      if (!window.confirm(copy.uninstallConfirm(plugin.packageName))) return
      remove.disabled = true
      pluginStatus.hidden = false
      pluginStatus.textContent = copy.uninstalling(plugin.packageName)
      void ipcRenderer.invoke('dsh:desktop:recovery-plugins:remove', plugin.packageName).then(() => {
        pluginsLoaded = false
        return loadPlugins(true)
      }).then(() => {
        pluginStatus.textContent = copy.uninstalled(plugin.packageName)
        pluginStatus.hidden = false
      }).catch((error: unknown) => {
        pluginStatus.textContent = `${copy.uninstallFailed}: ${error instanceof Error ? error.message : String(error)}`
        remove.disabled = false
      })
    })
    row.append(name, version, status, remove)
    return row
  }

  const snapshotSelect = element<HTMLSelectElement>('#snapshot-select')
  const snapshotNetwork = element<HTMLInputElement>('#snapshot-network')
  const snapshotRestore = element<HTMLButtonElement>('#snapshot-restore')
  const snapshotStatus = element<HTMLElement>('#snapshot-status')
  let restoreOperationId: string | undefined
  snapshotSelect.replaceChildren(new Option(copy.snapshotLoading, ''))
  snapshotSelect.disabled = true
  snapshotRestore.disabled = true
  void ipcRenderer.invoke('dsh:desktop:plugin-snapshots:list').then((value: unknown) => {
    if (!Array.isArray(value)) return
    const snapshots = (value as PluginSnapshotSummary[]).filter(snapshot => snapshot.kind !== 'safety')
    snapshotSelect.replaceChildren(...snapshots.map((snapshot) => {
      const name = snapshot.label ?? (snapshot.kind === 'bootable' ? copy.lastSuccessful : copy.automaticSnapshot)
      return new Option(`${name} · ${new Date(snapshot.createdAt).toLocaleString()}`, snapshot.snapshotId)
    }))
    snapshotSelect.disabled = snapshots.length === 0
    snapshotRestore.disabled = snapshots.length === 0
    if (snapshots.length === 0) snapshotSelect.replaceChildren(new Option(copy.noSnapshots, ''))
  }).catch(() => {
    snapshotSelect.replaceChildren(new Option(copy.noSnapshots, ''))
  })
  const snapshotListener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
    if (value === null || typeof value !== 'object') return
    const status = value as Partial<PluginSnapshotRestoreSnapshot>
    if (typeof status.operationId !== 'string' || typeof status.phase !== 'string'
      || (restoreOperationId !== undefined && status.operationId !== restoreOperationId)) return
    restoreOperationId = status.operationId
    snapshotStatus.hidden = false
    if (status.phase === 'needs-network') {
      snapshotStatus.textContent = status.message ?? copy.snapshotNeedsNetwork
      snapshotNetwork.checked = true
      snapshotRestore.disabled = false
    } else if (status.phase === 'rolled-back') {
      snapshotStatus.textContent = status.message ?? copy.snapshotRolledBack
      snapshotRestore.disabled = false
    } else if (status.phase === 'failed') {
      snapshotStatus.textContent = `${copy.snapshotFailed}${status.message === undefined ? '' : `: ${status.message}`}`
      snapshotRestore.disabled = false
    } else snapshotStatus.textContent = copy.snapshotRunning
  }
  ipcRenderer.on('dsh:desktop:plugin-snapshots:status', snapshotListener)
  window.addEventListener('unload', () => {
    ipcRenderer.removeListener('dsh:desktop:plugin-snapshots:status', snapshotListener)
  }, { once: true })
  snapshotRestore.addEventListener('click', () => {
    if (snapshotSelect.value === '' || !window.confirm(copy.snapshotConfirm)) return
    snapshotRestore.disabled = true
    snapshotStatus.hidden = false
    snapshotStatus.textContent = copy.snapshotRunning
    void ipcRenderer.invoke('dsh:desktop:plugin-snapshots:restore', snapshotSelect.value, snapshotNetwork.checked)
      .then((value: unknown) => {
        if (value !== null && typeof value === 'object') {
          const operationId = (value as { operationId?: unknown }).operationId
          if (typeof operationId === 'string') restoreOperationId = operationId
        }
      }).catch((error: unknown) => {
        snapshotStatus.textContent = `${copy.snapshotFailed}: ${error instanceof Error ? error.message : String(error)}`
        snapshotRestore.disabled = false
      })
  })

  const switchDataHome = element<HTMLButtonElement>('#switch-data-home')
  const directoryError = element<HTMLElement>('#directory-error')
  const showDirectoryError = (value: string): void => {
    directoryError.textContent = value
    directoryError.hidden = false
  }
  switchDataHome.addEventListener('click', () => {
    switchDataHome.disabled = true
    directoryError.hidden = true
    void ipcRenderer.invoke('dsh:desktop:data-home:choose-recovery').then(async (value) => {
      const selection = value as DesktopDataHomeSelectionResult
      if (selection.status === 'cancelled') return
      if (selection.status !== 'selected') {
        showDirectoryError(selection.status === 'unreadable' ? copy.unreadableDataHome : copy.invalidDataHome)
        return
      }
      const request: DesktopDataHomeSwitchRequest = selection.selectionKind === 'empty'
        ? { kind: 'create', selectionId: selection.selectionId }
        : { kind: 'custom', selectionId: selection.selectionId }
      const switched = await ipcRenderer.invoke('dsh:desktop:data-home:switch', request) as DesktopDataHomeSwitchResult
      if (!switched.restarting) showDirectoryError(copy.unchangedDataHome)
    }).catch(() => { showDirectoryError(copy.switchDataHomeFailed) })
      .finally(() => { switchDataHome.disabled = false })
  })
  void ipcRenderer.invoke('dsh:desktop:data-home:get').then((value) => {
    if ((value as DesktopDataHomeStatus).managedExternally) switchDataHome.hidden = true
  }, () => {
    // Keep the action visible when capability probing fails.
  })

  const openLogs = element<HTMLButtonElement>('#open-logs')
  openLogs.addEventListener('click', openLog)
  const exportDiagnostics = element<HTMLButtonElement>('#export-diagnostics')
  const diagnosticsStatus = element<HTMLElement>('#diagnostics-status')
  exportDiagnostics.addEventListener('click', () => {
    exportDiagnostics.disabled = true
    diagnosticsStatus.hidden = true
    void ipcRenderer.invoke('dsh:desktop:recovery:export').then((value: unknown) => {
      const result = value as { saved?: unknown; fileName?: unknown }
      if (result.saved === true) {
        diagnosticsStatus.textContent = `${copy.exported}${typeof result.fileName === 'string' ? `：${result.fileName}` : ''}`
        diagnosticsStatus.hidden = false
      }
    }).catch((error: unknown) => {
      diagnosticsStatus.textContent = `${copy.exportFailed}: ${error instanceof Error ? error.message : String(error)}`
      diagnosticsStatus.hidden = false
    }).finally(() => { exportDiagnostics.disabled = false })
  })
  retry.addEventListener('click', () => {
    retry.disabled = true
    void ipcRenderer.invoke('dsh:harness:retry').finally(() => { retry.disabled = false })
  })
  exitButton.addEventListener('click', () => {
    exitButton.disabled = true
    void ipcRenderer.invoke('dsh:desktop:recovery:exit')
  })
}

interface RecoveryCopy {
  readonly startupTitle: string
  readonly startupDescription: string
  readonly shutdownTitle: string
  readonly shutdownDescription: string
  readonly shutdownFailedTitle: string
  readonly shutdownFailedDescription: string
  readonly shutdownFailedHint: string
  readonly cleanupBlocked: string
  readonly retryCleanup: string
  readonly recoveryTitle: string
  readonly recoveryDescription: string
  readonly paused: string
  readonly viewDetails: string
  readonly hideDetails: string
  readonly logs: string
  readonly logLabel: string
  readonly slow: string
  readonly slowDetail: (task: string, elapsed: number, remaining?: number) => string
  readonly stages: Record<DesktopStartupStage, string>
  readonly operations: Record<string, string>
  readonly pluginLoading: string
  readonly pluginLoadFailed: string
  readonly pluginSource: (source: RecoveryPluginSource) => string
  readonly pluginAttention: (code?: string) => string
  readonly protectedComponents: (count: number) => string
  readonly uninstall: string
  readonly uninstallConfirm: (name: string) => string
  readonly uninstalling: (name: string) => string
  readonly uninstalled: (name: string) => string
  readonly uninstallFailed: string
  readonly snapshotLoading: string
  readonly lastSuccessful: string
  readonly automaticSnapshot: string
  readonly noSnapshots: string
  readonly snapshotConfirm: string
  readonly snapshotFailed: string
  readonly snapshotRunning: string
  readonly snapshotNeedsNetwork: string
  readonly snapshotRolledBack: string
  readonly invalidDataHome: string
  readonly unreadableDataHome: string
  readonly unchangedDataHome: string
  readonly switchDataHomeFailed: string
  readonly exported: string
  readonly exportFailed: string
}

const chineseCopy: RecoveryCopy = {
  startupTitle: '正在启动 DeepSeek Harness', startupDescription: '正在准备本地运行环境与预设插件。会话和凭据仅保存在本机。',
  shutdownTitle: '正在安全关闭 DeepSeek Harness', shutdownDescription: '正在停止任务并回收受管进程。确认配置不再被占用后才会退出或重启。',
  shutdownFailedTitle: '后台进程回收未完成', shutdownFailedDescription: '已阻止退出或重启，避免另一个 Harness 进程在配置仍被占用时启动。',
  shutdownFailedHint: '请查看日志了解未退出的任务，然后重试回收。这里不会提供绕过检查的强制重启。',
  cleanupBlocked: '安全关闭已暂停', retryCleanup: '重试回收',
  recoveryTitle: '诊断模式', recoveryDescription: '正常启动已暂停。当前仅开放诊断与恢复工具，请查看原因、日志或选择一种恢复方式。',
  paused: '启动已暂停', viewDetails: '查看错误详情', hideDetails: '收起错误详情', logs: '打开日志目录', logLabel: '日志：',
  slow: '启动时间较长，你可以打开 Harness 日志查看当前进度。',
  slowDetail: (task, elapsed, remaining) => remaining === undefined ? `${task} 已运行 ${elapsed} 秒。应用会自动降级或显示可恢复错误，不会无限等待。` : `${task} 已运行 ${elapsed} 秒，最迟约 ${remaining} 秒后自动降级。`,
  stages: { 'preparing-desktop': '正在准备桌面环境', 'preparing-runtime': '正在准备内置运行时', 'checking-profile': '正在检查插件兼容性', 'verifying-plugin': '正在校验插件', 'extracting-plugin': '正在解压插件', 'configuring-plugin': '正在配置插件', 'starting-harness': '正在启动 Harness', 'restarting-harness': '正在重新启动 Harness', 'waiting-background-tasks': '正在等待或取消后台修改任务', 'stopping-harness': '正在请求 Harness 和插件正常停止', 'reclaiming-processes': '正在回收受管进程树', 'checking-shutdown': '正在确认配置目录已解除占用', ready: '启动完成' },
  operations: { 'profile-read-only-check': '正在只读检查插件兼容性', 'profile-lock-wait': 'Profile 正被其他操作占用，等待其完成', 'profile-lock-diagnostics': 'Profile 正被其他操作占用，正在打开诊断模式', 'profile-diagnostics-ready': '诊断工具已就绪，正常 Profile 仍保持暂停', 'profile-check-timeout': '兼容性检查已超时，已跳过异常步骤并继续启动', 'profile-repair': '正在修复 Profile', 'profile-initialize': '正在初始化全新 Profile', 'profile-initialize-failed': '全新 Profile 初始化失败' },
  pluginLoading: '正在读取已安装插件…', pluginLoadFailed: '无法读取插件清单',
  pluginSource: source => ({ registry: '在线安装', bundled: '桌面预装', local: '本地来源', other: '其他来源' })[source],
  pluginAttention: code => code === undefined ? '诊断异常' : `诊断异常 · ${code}`,
  protectedComponents: count => `核心组件 ${count} 项 · 已锁定保护`, uninstall: '卸载',
  uninstallConfirm: name => `确认卸载 ${name}？将先暂停 Harness，并为本次变更创建插件快照。`,
  uninstalling: name => `正在卸载 ${name}…`, uninstalled: name => `${name} 已卸载。你可以继续处理其他插件，或点击“继续”重新启动。`, uninstallFailed: '插件卸载失败',
  snapshotLoading: '正在读取快照…', lastSuccessful: '最近成功启动', automaticSnapshot: '自动快照', noSnapshots: '没有可用的插件快照',
  snapshotConfirm: '将恢复所选插件快照。会话、凭据和插件配置不会改变。是否继续？', snapshotFailed: '插件快照恢复失败', snapshotRunning: '正在校验、恢复并重新启动…', snapshotNeedsNetwork: '本地缓存不完整，原状态已恢复。允许联网后可重试。', snapshotRolledBack: '所选快照未能安全启动，已自动恢复到操作前状态。',
  invalidDataHome: '请选择受支持的 DSH 配置目录，或选择一个完全空的目录来新建配置。', unreadableDataHome: '无法读取所选目录，请检查目录权限后重试。', unchangedDataHome: '当前已在使用这个配置目录，请选择其他目录。', switchDataHomeFailed: '配置目录切换失败，请重试或查看日志。',
  exported: '诊断报告已导出', exportFailed: '诊断报告导出失败',
}

const englishCopy: RecoveryCopy = {
  startupTitle: 'Starting DeepSeek Harness', startupDescription: 'Preparing the local runtime and preset plugins. Your sessions and credentials stay on this machine.',
  shutdownTitle: 'Closing DeepSeek Harness safely', shutdownDescription: 'Stopping tasks and reclaiming managed processes. Exit or restart continues only after the Profile is no longer in use.',
  shutdownFailedTitle: 'Background process cleanup did not complete', shutdownFailedDescription: 'Exit or restart was blocked so another Harness cannot start while the Profile may still be in use.',
  shutdownFailedHint: 'Inspect the log for the task that is still running, then retry cleanup. There is no force-restart bypass.',
  cleanupBlocked: 'Safe shutdown paused', retryCleanup: 'Retry cleanup',
  recoveryTitle: 'Diagnostics mode', recoveryDescription: 'Normal startup is paused. Only diagnostic and recovery tools are available until you inspect the cause or choose a recovery option.',
  paused: 'Startup paused', viewDetails: 'View error details', hideDetails: 'Hide error details', logs: 'Open log folder', logLabel: 'Log: ',
  slow: 'Startup is taking longer than expected. Open the Harness log to inspect its progress.',
  slowDetail: (task, elapsed, remaining) => remaining === undefined ? `${task} has run for ${elapsed}s. The app will degrade or show a recoverable error instead of waiting forever.` : `${task} has run for ${elapsed}s and will degrade in about ${remaining}s at the latest.`,
  stages: { 'preparing-desktop': 'Preparing desktop environment', 'preparing-runtime': 'Preparing the embedded runtime', 'checking-profile': 'Checking plugin compatibility', 'verifying-plugin': 'Verifying plugin', 'extracting-plugin': 'Extracting plugin', 'configuring-plugin': 'Configuring plugin', 'starting-harness': 'Starting Harness', 'restarting-harness': 'Restarting Harness', 'waiting-background-tasks': 'Waiting for or cancelling background mutations', 'stopping-harness': 'Requesting Harness and plugins to stop cleanly', 'reclaiming-processes': 'Reclaiming managed process trees', 'checking-shutdown': 'Confirming the Profile is no longer in use', ready: 'Startup complete' },
  operations: { 'profile-read-only-check': 'Checking plugin compatibility without changes', 'profile-lock-wait': 'Waiting for the operation that owns the Profile', 'profile-lock-diagnostics': 'Another operation owns the Profile; opening Diagnostics', 'profile-diagnostics-ready': 'Diagnostic tools are ready; the normal Profile remains paused', 'profile-check-timeout': 'Compatibility check timed out; skipped the step and continued startup', 'profile-repair': 'Repairing the Profile', 'profile-initialize': 'Initializing a new Profile', 'profile-initialize-failed': 'New Profile initialization failed' },
  pluginLoading: 'Loading installed plugins…', pluginLoadFailed: 'Could not load the plugin list',
  pluginSource: source => ({ registry: 'Online install', bundled: 'Desktop preset', local: 'Local source', other: 'Other source' })[source],
  pluginAttention: code => code === undefined ? 'Diagnostic issue' : `Diagnostic issue · ${code}`,
  protectedComponents: count => `${count} core components · protected`, uninstall: 'Uninstall',
  uninstallConfirm: name => `Uninstall ${name}? Harness will pause first and a plugin snapshot will protect this change.`,
  uninstalling: name => `Uninstalling ${name}…`, uninstalled: name => `${name} was removed. Continue with other plugins, or choose Continue to restart.`, uninstallFailed: 'Plugin uninstall failed',
  snapshotLoading: 'Loading snapshots…', lastSuccessful: 'Last successful startup', automaticSnapshot: 'Automatic snapshot', noSnapshots: 'No plugin snapshots are available',
  snapshotConfirm: 'Restore the selected plugin snapshot? Sessions, credentials, and plugin configuration will not change.', snapshotFailed: 'Plugin snapshot restore failed', snapshotRunning: 'Verifying, restoring, and restarting…', snapshotNeedsNetwork: 'The local cache is incomplete and the prior state was restored. Allow network access to retry.', snapshotRolledBack: 'The selected snapshot did not start safely, so the pre-restore state was restored.',
  invalidDataHome: 'Choose a supported DSH data directory, or a completely empty folder for a new configuration.', unreadableDataHome: 'The selected directory cannot be read. Check its permissions and try again.', unchangedDataHome: 'This configuration directory is already active. Choose a different directory.', switchDataHomeFailed: 'Could not switch the configuration directory. Retry or inspect the log.',
  exported: 'Diagnostic report exported', exportFailed: 'Could not export the diagnostic report',
}

function localizeRecoveryWorkspace(copy: RecoveryCopy): void {
  const text: Record<string, [string, string]> = {
    '#home-title': ['选择修复方式', 'Choose a recovery option'], '#home-subtitle': ['四种方式相互独立，无需按顺序操作。', 'These options are independent and can be used in any order.'],
    '#card-plugins-title': ['管理插件', 'Manage plugins'], '#card-plugins-description': ['卸载最近安装或异常的外部插件。', 'Remove recently installed or unhealthy external plugins.'], '#card-plugins-action': ['打开插件管理 →', 'Open plugin manager →'],
    '#card-snapshots-title': ['回退插件快照', 'Roll back plugin snapshot'], '#card-snapshots-description': ['恢复到之前保存的插件状态。', 'Restore a previously saved plugin state.'], '#card-snapshots-action': ['查看快照 →', 'View snapshots →'],
    '#card-directory-title': ['切换配置目录', 'Switch data directory'], '#card-directory-description': ['使用其他配置，或在空目录重新开始。', 'Use another configuration or begin again in an empty folder.'], '#card-directory-action': ['选择目录 →', 'Choose directory →'],
    '#card-diagnostics-title': ['导出诊断', 'Export diagnostics'], '#card-diagnostics-description': ['保存脱敏日志，便于进一步排查。', 'Save a redacted report for further troubleshooting.'], '#card-diagnostics-action': ['导出诊断 →', 'Export diagnostics →'],
    '#tab-plugins': ['插件管理', 'Plugin manager'], '#tab-snapshots': ['回退插件快照', 'Plugin snapshots'], '#tab-directory': ['切换配置目录', 'Data directory'], '#tab-diagnostics': ['导出诊断', 'Diagnostics'],
    '#plugins-title': ['检查已安装的插件', 'Check installed plugins'], '#plugins-description': ['核心组件已保护，会话和凭据不受影响。', 'Core components are protected. Sessions and credentials are not affected.'], '#plugin-column-name': ['插件', 'Plugin'], '#plugin-column-version': ['版本', 'Version'], '#plugin-column-status': ['状态', 'Status'], '#plugin-empty': ['没有可卸载的外部插件。', 'No removable external plugins are installed.'],
    '#snapshot-title': ['回退插件快照', 'Roll back plugin snapshot'], '#snapshot-description': ['仅恢复插件依赖、版本、顺序和构建许可，不会改变会话、凭据和插件配置。', 'Only plugin dependencies, versions, order and build permissions are restored.'], '#snapshot-restore': ['恢复快照', 'Restore snapshot'],
    '#directory-title': ['切换配置目录', 'Switch data directory'], '#directory-description': ['选择另一套已有配置，或选择空文件夹创建新配置。', 'Choose another existing configuration, or select an empty folder to create a new one.'], '#switch-data-home': ['选择目录', 'Choose directory'],
    '#diagnostics-title': ['导出诊断', 'Export diagnostics'], '#diagnostics-description': ['导出脱敏的启动与插件摘要，或打开本机日志目录进一步检查。', 'Export a redacted startup and plugin summary, or open the local log folder for deeper inspection.'], '#export-diagnostics': ['导出报告', 'Export report'], '#open-logs': ['打开日志目录', 'Open log folder'],
    '#safe-note': ['诊断模式不会加载当前 Profile 的第三方插件，也不会修改会话和凭据。', 'Diagnostics mode does not load third-party plugins from the active Profile or modify sessions and credentials.'], '#footer-hint': ['“继续”会先关闭诊断环境，再重新尝试正常启动。', 'Continue closes the diagnostic environment before retrying normal startup.'], '#exit': ['退出', 'Quit'], '#retry': ['重新尝试启动', 'Retry startup'],
  }
  const chinese = copy === chineseCopy
  for (const [selector, values] of Object.entries(text)) element<HTMLElement>(selector).textContent = values[chinese ? 0 : 1]
  element<HTMLElement>('.tabs').setAttribute('aria-label', chinese ? '修复选项' : 'Recovery options')
  const network = element<HTMLLabelElement>('.snapshot-network')
  const input = element<HTMLInputElement>('#snapshot-network')
  network.replaceChildren(input, ` ${chinese ? '本地缓存不完整时允许联网下载' : 'Allow network if the local cache is incomplete'}`)
}
