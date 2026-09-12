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

interface LocalizedFailure {
  readonly zh: readonly [title: string, guidance: string]
  readonly en: readonly [title: string, guidance: string]
}

const recoveryFailures: Readonly<Record<string, LocalizedFailure>> = {
  'session.persistence-corrupt': {
    zh: ['会话日志损坏', '一个历史会话文件无法读取。卸载重装不会删除或修复用户数据；请先导出诊断，再备份会话或切换配置目录。'],
    en: ['Corrupt session log', 'A stored session cannot be read. Reinstalling does not remove or repair user data; export diagnostics, then back up the sessions or switch data directories.'],
  },
  'profile.session-persistence-migration': {
    zh: ['会话存储迁移失败', '旧版会话存储未能安全迁移。原始数据会保留，请导出诊断后再处理会话存储。'],
    en: ['Session storage migration failed', 'Legacy session storage could not be migrated safely. The source data is preserved; export diagnostics before changing session storage.'],
  },
  'profile.module-resolution': {
    zh: ['插件或 Bundle 文件缺失', '某个插件依赖无法从当前 Profile 解析。可在插件管理中卸载对应外部插件，或回退到可用的插件快照。'],
    en: ['Plugin or Bundle file is missing', 'A plugin dependency cannot be resolved from this Profile. Remove the affected external plugin or restore a known-good plugin snapshot.'],
  },
  'loader.dependency-unavailable': {
    zh: ['插件依赖不可用', '插件声明的运行依赖没有加载成功。请优先卸载相关插件或恢复插件快照。'],
    en: ['Plugin dependency unavailable', 'A runtime dependency required by a plugin did not load. Remove the affected plugin or restore a plugin snapshot first.'],
  },
  'loader.duplicate-entry': {
    zh: ['插件功能与现有功能重名', '两个 Bundle 注册了相同的 Loader 入口。通常需要卸载较旧的第三方增强插件，再重新启动。'],
    en: ['Plugin feature duplicates an existing feature', 'Two Bundles registered the same Loader entry. Usually the older third-party enhancement should be removed before restarting.'],
  },
  'loader.duplicate-registration': {
    zh: ['插件重复注册服务', '多个插件注册了同一个服务、路由或配置项。请卸载最近安装或被标记异常的插件。'],
    en: ['Plugin registration conflict', 'Multiple plugins registered the same service, route, or setting. Remove the recently installed or flagged plugin.'],
  },
  'loader.unresolved-injection': {
    zh: ['插件所需服务未就绪', '插件一直在等待不存在或未启动的服务。请检查对应插件版本及其依赖。'],
    en: ['Required plugin service did not become ready', 'A plugin is waiting for a service that is missing or did not start. Check the affected plugin version and dependencies.'],
  },
  'loader.lifecycle-failed': {
    zh: ['插件启动失败', '插件在导入或激活阶段抛出错误。可卸载被标记的插件，或恢复到上一个可用快照。'],
    en: ['Plugin failed to start', 'A plugin failed while importing or activating. Remove the flagged plugin or restore the last known-good snapshot.'],
  },
  'loader.rollback-failed': {
    zh: ['插件回滚未完成', '插件启动失败后的清理也未能完成。请不要反复重试，先导出诊断并恢复插件快照。'],
    en: ['Plugin rollback did not complete', 'Cleanup after a plugin startup failure also failed. Do not repeatedly retry; export diagnostics and restore a plugin snapshot.'],
  },
  'profile.immutable-agent-input-mutation': {
    zh: ['插件修改了只读消息', '外部插件尝试修改新版 Harness 的只读 Agent 输入。请卸载不兼容插件并等待其适配当前版本。'],
    en: ['Plugin modified read-only agent input', 'An external plugin tried to mutate read-only Agent input in the current Harness. Remove the incompatible plugin until it is updated.'],
  },
  'profile.session-api-incompatible': {
    zh: ['插件使用了旧版会话接口', '外部插件仍依赖已经变更的 Session API。请卸载或升级对应插件。'],
    en: ['Plugin uses an obsolete Session API', 'An external plugin still depends on a changed Session API. Remove or update the affected plugin.'],
  },
  'profile.host-version-incompatible': {
    zh: ['插件与当前 Harness 版本不兼容', '插件声明的 Host 版本范围不包含当前版本。请升级、降级或卸载该插件。'],
    en: ['Plugin is incompatible with this Harness version', 'The plugin Host range does not include this version. Update, downgrade, or remove the plugin.'],
  },
  'profile.host-dependency-conflict': {
    zh: ['插件核心依赖冲突', '插件要求了与当前 Host 不兼容的核心依赖版本。请恢复插件快照或卸载冲突插件。'],
    en: ['Plugin host dependency conflict', 'A plugin requires a core dependency version incompatible with the current Host. Restore a snapshot or remove the conflicting plugin.'],
  },
  'profile.bundle-invalid': {
    zh: ['插件 Bundle 声明无效', '插件包结构或 Bundle 配置不符合当前格式。请卸载该插件或联系插件作者。'],
    en: ['Invalid plugin Bundle declaration', 'The plugin package structure or Bundle declaration is invalid. Remove it or contact the plugin author.'],
  },
  'profile.orphaned-bundle': {
    zh: ['发现已卸载插件的残留项', 'Profile 仍引用一个已经不存在的插件。可运行检查并修复，或打开配置文件移除残留。'],
    en: ['Removed plugin is still referenced', 'The Profile still references a plugin that no longer exists. Run repair or remove the stale entry from configuration.'],
  },
  'profile.patch-invalid': {
    zh: ['Profile 补丁无效', '用户或主目录补丁无法安全应用。请打开配置文件检查补丁格式、目标路径和不受支持的 YAML 类型。'],
    en: ['Invalid Profile patch', 'A Profile or home patch could not be applied safely. Inspect its format, target path, and unsupported YAML types.'],
  },
  'profile.quarantine-removal-residue': {
    zh: ['隔离插件仍有残留配置', '插件已经隔离，但 Profile 中仍留有引用。运行检查并修复可清理受管残留。'],
    en: ['Quarantined plugin left stale configuration', 'The plugin is quarantined but still referenced by the Profile. Run diagnostic repair to clean managed residue.'],
  },
  'profile.unknown': {
    zh: ['Profile 启动错误尚未归类', '已捕获脱敏证据，但现有规则无法可靠判断责任插件。请导出诊断，不要批量卸载插件。'],
    en: ['Profile startup error is not classified', 'Redacted evidence was captured, but no plugin can be attributed reliably. Export diagnostics instead of removing plugins in bulk.'],
  },
  'config.settings-invalid': {
    zh: ['设置文件格式错误', 'settings.yaml 无法安全解析。请打开配置文件修正 YAML；也可以导出诊断后重置损坏的设置。'],
    en: ['Invalid settings file', 'settings.yaml could not be parsed safely. Correct the YAML, or export diagnostics before resetting the damaged settings.'],
  },
  'config.credentials-invalid': {
    zh: ['凭据文件格式错误', '凭据配置无法解析，但不会在此页面显示密钥内容。请检查凭据文件结构或切换配置目录。'],
    en: ['Invalid credentials file', 'The credentials configuration cannot be parsed; secret values are not shown here. Check its structure or switch data directories.'],
  },
  'pnpm.build-script-blocked': {
    zh: ['插件构建脚本需要授权', '依赖安装被构建许可策略阻止。请仅在确认插件来源可信后批准构建。'],
    en: ['Plugin build script needs approval', 'Dependency installation was blocked by the build-approval policy. Approve only when the plugin source is trusted.'],
  },
  'pnpm.unexpected-store': {
    zh: ['插件依赖存储位置不一致', '当前 node_modules 来自另一个 pnpm store。请使用诊断修复重新冻结依赖，不要手工复制 node_modules。'],
    en: ['Plugin dependency store mismatch', 'The current node_modules belongs to another pnpm store. Use diagnostic repair to freeze dependencies again instead of copying node_modules.'],
  },
  'pnpm.network': {
    zh: ['插件依赖下载失败', '插件安装时网络连接中断。检查下载源或代理后重试；现有 Profile 数据不会因此被删除。'],
    en: ['Plugin dependency download failed', 'The network failed during plugin installation. Check the source or proxy and retry; existing Profile data is not removed.'],
  },
  'pnpm.registry-auth': {
    zh: ['插件仓库拒绝访问', 'Registry 返回了认证或权限错误。请检查私有源凭据及 registry 配置。'],
    en: ['Plugin registry denied access', 'The registry returned an authentication or permission error. Check private registry credentials and configuration.'],
  },
  'pnpm.lockfile': {
    zh: ['插件锁文件不一致', '插件清单与锁文件无法一致解析。请使用检查并修复重新生成受管依赖。'],
    en: ['Plugin lockfile is inconsistent', 'The plugin manifest and lockfile cannot be resolved together. Use diagnostic repair to regenerate managed dependencies.'],
  },
  'pnpm.integrity': {
    zh: ['插件包完整性校验失败', '下载内容与可信校验值不一致。为安全起见不会继续加载，请勿绕过校验。'],
    en: ['Plugin package integrity check failed', 'Downloaded content does not match its trusted integrity value. It will not be loaded; do not bypass this check.'],
  },
  'pnpm.minimum-release-age': {
    zh: ['插件版本尚未达到安全等待期', '所选版本过新或缺少可信发布时间，依赖策略暂时拒绝安装。请等待镜像同步后重试。'],
    en: ['Plugin version has not passed the safety delay', 'The selected version is too new or lacks trusted publish time metadata. Wait for registry synchronization and retry.'],
  },
  'pnpm.patch-failed': {
    zh: ['插件补丁无法应用', '现有补丁与当前依赖内容不匹配。请检查补丁目标版本，不会用忽略补丁的方式继续安装。'],
    en: ['Plugin patch could not be applied', 'The existing patch does not match the current dependency content. Check its target version; installation will not continue by ignoring it.'],
  },
  'pnpm.runtime-version': {
    zh: ['插件依赖要求不同的 Node 版本', '依赖的运行时或模块格式与内置 Node 不兼容。请更换兼容插件版本。'],
    en: ['Plugin dependency requires a different Node version', 'The dependency runtime or module layout is incompatible with the embedded Node. Use a compatible plugin version.'],
  },
  'pnpm.peer-dependency': {
    zh: ['插件的对等依赖冲突', '插件要求的共享依赖版本无法同时满足。请升级或卸载冲突插件，不会强制忽略版本约束。'],
    en: ['Plugin peer dependency conflict', 'The shared dependency versions requested by plugins cannot all be satisfied. Update or remove the conflicting plugin; constraints will not be forced.'],
  },
  'pnpm.supply-chain': {
    zh: ['插件供应链安全检查失败', '依赖来源或覆盖规则触发安全保护。请核实插件来源与锁定信息，不要绕过检查。'],
    en: ['Plugin supply-chain check failed', 'A dependency source or override triggered a safety policy. Verify the plugin source and lock information instead of bypassing the check.'],
  },
  'pnpm.version-resolution': {
    zh: ['找不到所需的插件版本', '配置或锁文件引用的精确版本在当前来源不可用。请检查版本和下载源后重试。'],
    en: ['Required plugin version was not found', 'The exact version referenced by configuration or the lockfile is unavailable from the current source. Check both before retrying.'],
  },
  'pnpm.invalid-dependency': {
    zh: ['插件依赖声明无效', '插件清单包含不受支持的包名或来源格式。请检查插件配置或联系插件作者。'],
    en: ['Invalid plugin dependency declaration', 'The plugin manifest contains an unsupported package name or source format. Inspect its configuration or contact the plugin author.'],
  },
  'pnpm.config-parse': {
    zh: ['pnpm 配置文件格式错误', '工作区或 pnpm 配置无法解析。请修正对应 YAML/JSON 文件后再运行修复。'],
    en: ['Invalid pnpm configuration', 'The workspace or pnpm configuration could not be parsed. Correct the relevant YAML or JSON file before running repair.'],
  },
  'runtime.launch-invalid': {
    zh: ['内置运行环境无法启动', 'Node、pnpm 或 Harness 启动入口不可用。这通常需要修复安装文件，而不是卸载普通插件。'],
    en: ['Embedded runtime could not start', 'The Node, pnpm, or Harness entry point is unavailable. This usually requires repairing the app installation, not removing a normal plugin.'],
  },
  'desktop.harness-startup-failed': {
    zh: ['Harness 启动后立即退出', '没有生成可用的 Profile 分类报告。请展开详情查看退出原因并导出日志；不要在无法归属插件时批量卸载。'],
    en: ['Harness exited during startup', 'No usable Profile classification report was produced. Expand the details and export logs; do not remove plugins in bulk without attribution.'],
  },
  'desktop.profile-initialize-failed': {
    zh: ['全新 Profile 初始化失败', '首次创建配置时依赖或受管文件没有准备完成。请检查日志、磁盘权限和网络设置，修复后再重试。'],
    en: ['New Profile initialization failed', 'Dependencies or managed files were not prepared during first-time setup. Check logs, disk permissions, and network settings before retrying.'],
  },
  'desktop.profile-transaction-rollback-failed': {
    zh: ['插件变更无法安全回滚', '安装、更新或卸载插件后的恢复事务未完成。请优先恢复插件快照，不要继续修改当前 Profile。'],
    en: ['Plugin change could not be rolled back safely', 'Recovery after a plugin install, update, or removal did not settle. Restore a plugin snapshot before making more Profile changes.'],
  },
  'desktop.process-recovery-blocked': {
    zh: ['后台进程状态阻止启动', '应用无法确认上次受管进程已经退出。可在“导出诊断”中重置损坏的进程恢复记录；不会删除会话或插件。'],
    en: ['Background process state blocked startup', 'The app cannot prove that prior managed processes exited. Reset the damaged process recovery record under Diagnostics; sessions and plugins are preserved.'],
  },
  'desktop.profile-lock-busy': {
    zh: ['配置目录正被另一个操作占用', '检测到仍然存活的 Profile 写锁。请关闭另一个客户端或等待其完成，不会强行抢占该锁。'],
    en: ['Data directory is owned by another operation', 'A live Profile write lock was detected. Close the other client or wait for it to finish; the lock will not be stolen.'],
  },
  'desktop.diagnostic-report-invalid': {
    zh: ['诊断报告本身已损坏', 'Profile 的诊断元数据无法读取，因此不能安全判断具体插件。请导出日志或切换配置目录，不要盲目卸载。'],
    en: ['Diagnostic report is damaged', 'The Profile diagnostic metadata cannot be read, so no plugin can be attributed safely. Export logs or switch data directories instead of removing plugins blindly.'],
  },
}

interface FailurePresentation {
  readonly code: string
  readonly title: string
  readonly guidance: string
  readonly context: string
}

function recoveryFailureCopy(query: URLSearchParams, copy: RecoveryCopy): FailurePresentation | undefined {
  const code = query.get('diagnosticCode')?.slice(0, 120)
  if (code === undefined || !/^[a-z][a-z0-9.-]+$/u.test(code)) return undefined
  const chinese = copy === chineseCopy
  const generic: LocalizedFailure = code.startsWith('pnpm.')
    ? { zh: ['插件依赖处理失败', 'pnpm 未能完成插件依赖操作。请查看错误码和日志，再选择重试、修复或回退快照。'], en: ['Plugin dependency operation failed', 'pnpm could not complete the plugin dependency operation. Inspect the code and log before retrying, repairing, or restoring a snapshot.'] }
    : code.startsWith('loader.') || code.startsWith('profile.')
      ? { zh: ['Profile 或插件无法启动', 'Profile 检查发现插件结构或兼容性问题。请根据相关对象选择卸载、修复或回退快照。'], en: ['Profile or plugin could not start', 'Profile checks found a plugin structure or compatibility problem. Use the affected item to decide whether to remove, repair, or restore.'] }
      : { zh: ['启动错误已被分类', '应用已保留具体诊断码和脱敏证据。请查看详情后选择合适的恢复方式。'], en: ['Startup error classified', 'The app retained a specific diagnostic code and redacted evidence. Review the details before choosing a recovery option.'] }
  const localized = recoveryFailures[code] ?? generic
  const [title, guidance] = chinese ? localized.zh : localized.en
  const contextValues = [
    query.get('packageName')?.slice(0, 240), query.get('entryId')?.slice(0, 240),
    query.get('moduleName')?.slice(0, 240), query.get('nativeCode')?.slice(0, 120),
  ].filter((value): value is string => value !== undefined && value.length > 0)
  return { code, title, guidance, context: contextValues.length === 0 ? '' : copy.affectedContext(contextValues) }
}

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
  const failureTitle = element<HTMLElement>('#failure-title')
  const failureMessage = element<HTMLElement>('#failure-message')
  const failureContext = element<HTMLElement>('#failure-context')
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
  const diagnostic = shutdown ? undefined : recoveryFailureCopy(query, copy)
  if (diagnostic !== undefined) {
    progressTask.textContent = diagnostic.title
    progress.setAttribute('aria-valuetext', diagnostic.title)
    description.textContent = diagnostic.guidance
    failureTitle.textContent = `${diagnostic.title} · ${diagnostic.code}`
    failureMessage.textContent = query.get('evidence') ?? query.get('message') ?? diagnostic.guidance
    failureContext.textContent = diagnostic.context
    failureContext.hidden = diagnostic.context.length === 0
  } else {
    failureTitle.textContent = shutdown ? copy.cleanupBlocked : copy.unknownFailureTitle
    failureMessage.textContent = query.get('message') ?? copy.recoveryDescription
    failureContext.hidden = true
  }
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
  const resetProcessRecovery = element<HTMLButtonElement>('#reset-process-recovery')
  const exportDiagnostics = element<HTMLButtonElement>('#export-diagnostics')
  const diagnosticsStatus = element<HTMLElement>('#diagnostics-status')
  void ipcRenderer.invoke('dsh:desktop:process-recovery:get').then((value: unknown) => {
    const resetAvailable = value !== null && typeof value === 'object'
      && (value as { resetAvailable?: unknown }).resetAvailable === true
    resetProcessRecovery.hidden = !resetAvailable
    if (resetAvailable) retry.disabled = true
  }, () => {
    // The reset remains hidden when capability probing fails.
  })
  resetProcessRecovery.addEventListener('click', () => {
    if (!window.confirm(copy.processRecoveryResetConfirm)) return
    resetProcessRecovery.disabled = true
    diagnosticsStatus.hidden = false
    diagnosticsStatus.textContent = copy.processRecoveryResetting
    void ipcRenderer.invoke('dsh:desktop:process-recovery:reset').catch((error: unknown) => {
      diagnosticsStatus.textContent = `${copy.processRecoveryResetFailed}: ${error instanceof Error ? error.message : String(error)}`
      resetProcessRecovery.disabled = false
    })
  })
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
  readonly unknownFailureTitle: string
  readonly affectedContext: (values: readonly string[]) => string
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
  readonly processRecoveryResetConfirm: string
  readonly processRecoveryResetting: string
  readonly processRecoveryResetFailed: string
}

const chineseCopy: RecoveryCopy = {
  startupTitle: '正在启动 DeepSeek Harness', startupDescription: '正在准备本地运行环境与预设插件。会话和凭据仅保存在本机。',
  shutdownTitle: '正在安全关闭 DeepSeek Harness', shutdownDescription: '正在停止任务并回收受管进程。确认配置不再被占用后才会退出或重启。',
  shutdownFailedTitle: '后台进程回收未完成', shutdownFailedDescription: '已阻止退出或重启，避免另一个 Harness 进程在配置仍被占用时启动。',
  shutdownFailedHint: '请查看日志了解未退出的任务，然后重试回收。这里不会提供绕过检查的强制重启。',
  cleanupBlocked: '安全关闭已暂停', retryCleanup: '重试回收',
  recoveryTitle: '诊断模式', recoveryDescription: '正常启动已暂停。当前仅开放诊断与恢复工具，请查看原因、日志或选择一种恢复方式。',
  unknownFailureTitle: '启动原因尚未分类', affectedContext: values => `相关对象：${values.join(' · ')}`,
  paused: '启动已暂停', viewDetails: '查看错误详情', hideDetails: '收起错误详情', logs: '打开日志目录', logLabel: '日志：',
  slow: '启动时间较长，你可以打开 Harness 日志查看当前进度。',
  slowDetail: (task, elapsed, remaining) => remaining === undefined ? `${task} 已运行 ${elapsed} 秒。应用会自动降级或显示可恢复错误，不会无限等待。` : `${task} 已运行 ${elapsed} 秒，最迟约 ${remaining} 秒后自动降级。`,
  stages: { 'preparing-desktop': '正在准备桌面环境', 'preparing-runtime': '正在准备内置运行时', 'checking-profile': '正在检查插件兼容性', 'verifying-plugin': '正在校验插件', 'extracting-plugin': '正在解压插件', 'configuring-plugin': '正在配置插件', 'starting-harness': '正在启动 Harness', 'restarting-harness': '正在重新启动 Harness', 'waiting-background-tasks': '正在等待或取消后台修改任务', 'stopping-harness': '正在请求 Harness 和插件正常停止', 'reclaiming-processes': '正在回收受管进程树', 'checking-shutdown': '正在确认配置目录已解除占用', ready: '启动完成' },
  operations: { 'profile-read-only-check': '正在只读检查插件兼容性', 'profile-lock-wait': 'Profile 正被其他操作占用，等待其完成', 'profile-lock-diagnostics': 'Profile 正被其他操作占用，正在打开诊断模式', 'profile-diagnostics-ready': '诊断工具已就绪，正常 Profile 仍保持暂停', 'profile-check-timeout': '兼容性检查已超时，已跳过异常步骤并继续启动', 'profile-repair': '正在修复 Profile', 'profile-initialize': '正在初始化全新 Profile', 'profile-initialize-failed': '全新 Profile 初始化失败', 'process-recovery-blocked': '后台进程恢复未完成，已打开诊断模式' },
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
  processRecoveryResetConfirm: '仅重置后台进程恢复记录并重新启动，不会删除会话、配置、插件或凭据。是否继续？',
  processRecoveryResetting: '后台进程恢复记录已隔离，正在重新启动…', processRecoveryResetFailed: '无法重置后台进程恢复记录',
}

const englishCopy: RecoveryCopy = {
  startupTitle: 'Starting DeepSeek Harness', startupDescription: 'Preparing the local runtime and preset plugins. Your sessions and credentials stay on this machine.',
  shutdownTitle: 'Closing DeepSeek Harness safely', shutdownDescription: 'Stopping tasks and reclaiming managed processes. Exit or restart continues only after the Profile is no longer in use.',
  shutdownFailedTitle: 'Background process cleanup did not complete', shutdownFailedDescription: 'Exit or restart was blocked so another Harness cannot start while the Profile may still be in use.',
  shutdownFailedHint: 'Inspect the log for the task that is still running, then retry cleanup. There is no force-restart bypass.',
  cleanupBlocked: 'Safe shutdown paused', retryCleanup: 'Retry cleanup',
  recoveryTitle: 'Diagnostics mode', recoveryDescription: 'Normal startup is paused. Only diagnostic and recovery tools are available until you inspect the cause or choose a recovery option.',
  unknownFailureTitle: 'Startup cause is not yet classified', affectedContext: values => `Affected: ${values.join(' · ')}`,
  paused: 'Startup paused', viewDetails: 'View error details', hideDetails: 'Hide error details', logs: 'Open log folder', logLabel: 'Log: ',
  slow: 'Startup is taking longer than expected. Open the Harness log to inspect its progress.',
  slowDetail: (task, elapsed, remaining) => remaining === undefined ? `${task} has run for ${elapsed}s. The app will degrade or show a recoverable error instead of waiting forever.` : `${task} has run for ${elapsed}s and will degrade in about ${remaining}s at the latest.`,
  stages: { 'preparing-desktop': 'Preparing desktop environment', 'preparing-runtime': 'Preparing the embedded runtime', 'checking-profile': 'Checking plugin compatibility', 'verifying-plugin': 'Verifying plugin', 'extracting-plugin': 'Extracting plugin', 'configuring-plugin': 'Configuring plugin', 'starting-harness': 'Starting Harness', 'restarting-harness': 'Restarting Harness', 'waiting-background-tasks': 'Waiting for or cancelling background mutations', 'stopping-harness': 'Requesting Harness and plugins to stop cleanly', 'reclaiming-processes': 'Reclaiming managed process trees', 'checking-shutdown': 'Confirming the Profile is no longer in use', ready: 'Startup complete' },
  operations: { 'profile-read-only-check': 'Checking plugin compatibility without changes', 'profile-lock-wait': 'Waiting for the operation that owns the Profile', 'profile-lock-diagnostics': 'Another operation owns the Profile; opening Diagnostics', 'profile-diagnostics-ready': 'Diagnostic tools are ready; the normal Profile remains paused', 'profile-check-timeout': 'Compatibility check timed out; skipped the step and continued startup', 'profile-repair': 'Repairing the Profile', 'profile-initialize': 'Initializing a new Profile', 'profile-initialize-failed': 'New Profile initialization failed', 'process-recovery-blocked': 'Background process recovery did not complete; Diagnostics is open' },
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
  processRecoveryResetConfirm: 'Reset only the background-process recovery record and restart? Sessions, settings, plugins, and credentials are not removed.',
  processRecoveryResetting: 'The background-process recovery record was quarantined. Restarting…', processRecoveryResetFailed: 'Could not reset the background-process recovery record',
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
    '#diagnostics-title': ['导出诊断', 'Export diagnostics'], '#diagnostics-description': ['导出脱敏的启动与插件摘要，或打开本机日志目录进一步检查。', 'Export a redacted startup and plugin summary, or open the local log folder for deeper inspection.'], '#export-diagnostics': ['导出报告', 'Export report'], '#open-logs': ['打开日志目录', 'Open log folder'], '#reset-process-recovery': ['重置后台进程记录', 'Reset background process record'],
    '#safe-note': ['诊断模式不会加载当前 Profile 的第三方插件，也不会修改会话和凭据。', 'Diagnostics mode does not load third-party plugins from the active Profile or modify sessions and credentials.'], '#footer-hint': ['“继续”会先关闭诊断环境，再重新尝试正常启动。', 'Continue closes the diagnostic environment before retrying normal startup.'], '#exit': ['退出', 'Quit'], '#retry': ['重新尝试启动', 'Retry startup'],
  }
  const chinese = copy === chineseCopy
  for (const [selector, values] of Object.entries(text)) element<HTMLElement>(selector).textContent = values[chinese ? 0 : 1]
  element<HTMLElement>('.tabs').setAttribute('aria-label', chinese ? '修复选项' : 'Recovery options')
  const network = element<HTMLLabelElement>('.snapshot-network')
  const input = element<HTMLInputElement>('#snapshot-network')
  network.replaceChildren(input, ` ${chinese ? '本地缓存不完整时允许联网下载' : 'Allow network if the local cache is incomplete'}`)
}
