import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('desktop loading page', () => {
  it('uses one determinate left-to-right bar with task and percentage labels', async () => {
    const html = await readFile(new URL('../src/loading.html', import.meta.url), 'utf8')
    const preload = await readFile(new URL('../src/preload.ts', import.meta.url), 'utf8')

    expect(html).toContain('id="progress-task"')
    expect(html).toContain('id="progress-percent"')
    expect(html).toContain('id="progress-bar"')
    expect(html).toContain('aria-valuemax="100"')
    expect(html).not.toContain('infinite alternate')
    expect(html).not.toContain('@keyframes progress')
    expect(html).toContain('color-scheme: light dark')
    expect(html).toContain('@media (prefers-color-scheme: dark)')
    expect(preload).toContain("getAttribute('data-dsh-color-scheme-source')")
    expect(preload).toContain("ipcRenderer.send('dsh:desktop:theme-source', source)")
    expect(preload).toContain("attributeFilter: ['data-dsh-color-scheme-source']")
  })

  it('offers a bounded data-home recovery action only after startup failure', async () => {
    const html = await readFile(new URL('../src/loading.html', import.meta.url), 'utf8')
    const loadingPage = await readFile(new URL('../src/loading-page.ts', import.meta.url), 'utf8')

    expect(html).toContain('id="switch-data-home"')
    expect(html).toContain('id="directory-error"')
    expect(loadingPage).toContain("ipcRenderer.invoke('dsh:desktop:data-home:choose-recovery')")
    expect(loadingPage).toContain("selection.selectionKind === 'empty'")
    expect(loadingPage).toContain("{ kind: 'create', selectionId: selection.selectionId }")
    expect(loadingPage).toContain("{ kind: 'custom', selectionId: selection.selectionId }")
    expect(loadingPage).not.toContain("{ kind: 'custom', path:")
  })

  it('lets source builds preview and leave the real recovery page without stopping Harness', async () => {
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    const preload = await readFile(new URL('../src/preload.ts', import.meta.url), 'utf8')

    expect(preload).toContain("ipcRenderer.invoke(\n    'dsh:desktop:recovery:enter'")
    expect(main).toContain("ipcMain.handle('dsh:desktop:recovery:enter'")
    expect(main).toContain("if (app.isPackaged) throw new Error('desktop: recovery preview is available only in development mode')")
    expect(main).toContain("if (harnessOrigin === undefined) throw new Error('desktop: Harness must be ready before opening recovery mode')")
    expect(main).toContain("showLoading('failed'")
    expect(main).toContain('void mainSurface.loadURL(withDesktopWindowMetadata(harnessOrigin, process.platform))')
  })

  it('restricts recovery plugin removal to direct package identities in the main process', async () => {
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(main).toContain("ipcMain.handle('dsh:desktop:recovery-plugins:list'")
    expect(main).toContain("ipcMain.handle('dsh:desktop:recovery-plugins:remove'")
    expect(main).toContain('isRecoveryPluginPackageName(packageName)')
    expect(main).toContain('inventory.plugins.some(plugin => plugin.packageName === packageName)')
    expect(main).toContain("'plugin', '--profile', 'web', 'remove', packageName")
    expect(main).toContain('await stopAndRevokePersistentServicesForPlugin(packageName)')
  })

  it('shows the active bounded operation and its automatic degradation policy', async () => {
    const loadingPage = await readFile(new URL('../src/loading-page.ts', import.meta.url), 'utf8')

    expect(loadingPage).toContain("'profile-read-only-check': '正在只读检查插件兼容性'")
    expect(loadingPage).toContain("'profile-check-timeout': '兼容性检查已超时，已跳过异常步骤并继续启动'")
    expect(loadingPage).toContain('snapshot.deadlineAt - now')
    expect(loadingPage).toContain("ipcRenderer.invoke('dsh:desktop:log:open')")
    expect(loadingPage).toContain('不会无限等待')
  })

  it('uses the real shutdown stages instead of presenting cleanup as startup', async () => {
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    const loadingPage = await readFile(new URL('../src/loading-page.ts', import.meta.url), 'utf8')

    expect(main).toContain("{ stage: 'waiting-background-tasks', progress: 12 }")
    expect(main).toContain("{ stage: 'stopping-harness', progress: 38 }")
    expect(main).toContain("{ stage: 'reclaiming-processes', progress: 72 }")
    expect(main).toContain("{ stage: 'checking-shutdown', progress: 94 }")
    expect(main).toContain("{ mode: 'shutdown' }")
    expect(loadingPage).toContain("const shutdown = query.get('mode') === 'shutdown'")
    expect(loadingPage).toContain("shutdownTitle: '正在安全关闭 DeepSeek Harness'")
    expect(loadingPage).toContain("'reclaiming-processes': 'Reclaiming managed process trees'")
    expect(loadingPage).toContain("ipcRenderer.invoke('dsh:desktop:shutdown:retry')")
    expect(main).toContain("ipcMain.handle('dsh:desktop:shutdown:retry'")
    expect(main).toContain("}, 'shutdown')")
  })

  it('keeps the paused startup bar while exposing four peer recovery tools', async () => {
    const html = await readFile(new URL('../src/loading.html', import.meta.url), 'utf8')
    const loadingPage = await readFile(new URL('../src/loading-page.ts', import.meta.url), 'utf8')
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(html).toContain('id="recovery-home"')
    expect(html).toContain('data-open-panel="plugins"')
    expect(html).toContain('data-open-panel="snapshots"')
    expect(html).toContain('data-open-panel="directory"')
    expect(html).toContain('data-open-panel="diagnostics"')
    expect(html).toContain('role="tablist"')
    expect(html).not.toContain('id="previous"')
    expect(html).toContain('body.recovery { overflow: hidden; }')
    expect(html).toContain('#recovery-home, #recovery-detail { min-height: 0; overflow: auto;')
    expect(loadingPage).toContain("const failed = query.get('state') === 'failed'")
    expect(loadingPage).toContain("if (!failed) {\n    ipcRenderer.on('dsh:startup-progress'")
    expect(loadingPage).toContain('progressTask.textContent = shutdown ? copy.cleanupBlocked : copy.paused')
    expect(loadingPage).toContain("ipcRenderer.invoke('dsh:desktop:recovery-plugins:list')")
    expect(loadingPage).toContain("ipcRenderer.invoke('dsh:desktop:recovery-plugins:remove', plugin.packageName)")
    expect(loadingPage).toContain("ipcRenderer.invoke('dsh:desktop:recovery:export')")
    expect(html).toContain('id="reset-process-recovery"')
    expect(loadingPage).toContain("ipcRenderer.invoke('dsh:desktop:process-recovery:get')")
    expect(loadingPage).toContain("ipcRenderer.invoke('dsh:desktop:process-recovery:reset')")
    expect(main).toContain("ipcMain.handle('dsh:desktop:process-recovery:reset'")
  })

  it('keeps the diagnostic Profile behind the recovery page instead of opening it as the app', async () => {
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    const loadingPage = await readFile(new URL('../src/loading-page.ts', import.meta.url), 'utf8')
    const diagnosticReady = main.slice(
      main.indexOf('onDiagnosticReady:'),
      main.indexOf('onState:', main.indexOf('onDiagnosticReady:')),
    )

    expect(diagnosticReady).toContain("showLoading('failed'")
    expect(diagnosticReady).not.toContain('mainSurface.loadURL')
    expect(main).toContain('if (supervisor?.isDiagnosticMode === true) {\n      await supervisor.stop()')
    expect(loadingPage).toContain("recoveryTitle: '诊断模式'")
    expect(loadingPage).toContain('当前仅开放诊断与恢复工具')
    expect(loadingPage).toContain("'#retry': ['重新尝试启动', 'Retry startup']")
  })
})
