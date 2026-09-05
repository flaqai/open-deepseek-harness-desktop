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
    const preload = await readFile(new URL('../src/preload.ts', import.meta.url), 'utf8')

    expect(html).toContain('id="switch-data-home"')
    expect(html).toContain('id="directory-error"')
    expect(preload).toContain("ipcRenderer.invoke('dsh:desktop:data-home:choose-recovery')")
    expect(preload).toContain("selection.selectionKind === 'empty'")
    expect(preload).toContain("{ kind: 'create', selectionId: selection.selectionId }")
    expect(preload).toContain("{ kind: 'custom', selectionId: selection.selectionId }")
    expect(preload).not.toContain("{ kind: 'custom', path:")
  })

  it('shows the active bounded operation and its automatic degradation policy', async () => {
    const preload = await readFile(new URL('../src/preload.ts', import.meta.url), 'utf8')

    expect(preload).toContain("'profile-read-only-check': '正在只读检查插件兼容性'")
    expect(preload).toContain("'profile-check-timeout': '兼容性检查已超时，已跳过异常步骤并继续启动'")
    expect(preload).toContain('snapshot.deadlineAt - now')
    expect(preload).toContain("ipcRenderer.invoke('dsh:desktop:log:open')")
    expect(preload).toContain('不会无限等待')
  })
})
