/** Isolated Electron integration smoke; run with the project development Electron after building Desktop. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { app, ipcMain, Menu } from 'electron'
import { createDesktopWindowSurface } from '../lib/desktop-window-surface.js'
import { ApplicationMenuController } from '../lib/application-menu-controller.js'

const temporary = mkdtempSync(join(tmpdir(), 'desktop-menu-smoke-'))
app.setName('Open DeepSeek Harness Desktop')
app.setPath('userData', temporary)
async function waitFor(check, description) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${description}`)
}
async function smoke() {
await app.whenReady()
const failures = []
// Exercise real split WebContents on this host; this is not Windows/Linux release qualification.
const surface = createDesktopWindowSurface({
  platform: 'win32', window: { width: 900, height: 600, show: false },
  rendererPreferences: { sandbox: true, contextIsolation: true },
  titlebarPreferences: { sandbox: true, contextIsolation: true, preload: fileURLToPath(new URL('../lib/titlebar-preload.cjs', import.meta.url)) },
  titlebarPage: fileURLToPath(new URL('../lib/titlebar.html', import.meta.url)),
  onSplitFailure: error => { failures.push(error) },
})
const controller = new ApplicationMenuController({
  surface: () => surface,
  state: () => ({ platform: process.platform, locale: 'zh', ready: true, busy: false, maximized: false, fullscreen: false, development: true }),
  icon: () => 'data:image/png;base64,', execute: () => {}, reportError: error => { failures.push(error) },
})
const dispose = controller.register(ipcMain)
try {
  await surface.initialize()
  await surface.loadURL('data:text/html,<textarea id="draft">saved draft</textarea>')
  surface.window.show()
  controller.refresh()
  controller.attach(surface)
  assert.equal(Menu.getApplicationMenu().getMenuItemById('settings').label, '设置…')
  assert.equal(app.getName(), 'Open DeepSeek Harness Desktop')
  const [width, height] = surface.window.getContentSize()
  assert.deepEqual(surface.window.contentView.children[0].getBounds(), { x: 0, y: 36, width, height: height - 36 })
  assert.equal(await surface.renderer.executeJavaScript('window.innerHeight'), height - 36)
  await surface.renderer.executeJavaScript('document.getElementById("draft").focus()')
  controller.execute('select-all')
  assert.equal(await surface.renderer.executeJavaScript('document.getElementById("draft").value'), 'saved draft')
  controller.execute('zoom-in')
  assert.equal(surface.renderer.getZoomLevel(), 0.5)
  assert.equal(surface.titlebarRenderer.getZoomLevel(), 0)
  controller.execute('zoom-reset')
  await waitFor(() => surface.titlebarRenderer.executeJavaScript(
    'Boolean(document.querySelector("[data-group=file]"))',
  ), 'titlebar menu presentation')
  const presentation = await surface.titlebarRenderer.executeJavaScript(`({
    groups: [...document.querySelectorAll('.menu-button')].map(button => button.textContent),
    restricted: typeof window.deepSeekHarnessDesktop,
    height: document.body.offsetHeight,
  })`)
  assert.ok(presentation.groups.includes('文件'))
  assert.ok(presentation.groups.includes('工具'))
  assert.equal(presentation.restricted, 'undefined')
  assert.equal(presentation.height, 36)
  const fileMenu = Menu.getApplicationMenu().getMenuItemById('file').submenu
  let opened = false
  fileMenu.once('menu-will-show', () => { opened = true })
  await surface.titlebarRenderer.executeJavaScript('document.querySelector("[data-group=file]").click()')
  await waitFor(() => opened, 'native file menu to open')
  assert.equal(opened, true)
  fileMenu.closePopup(surface.window)
  surface.window.setSize(400, 600)
  await waitFor(() => surface.titlebarRenderer.executeJavaScript(
    'document.querySelector("[data-group=more]").hidden === false',
  ), 'narrow titlebar overflow')
  assert.equal(await surface.titlebarRenderer.executeJavaScript('document.querySelector("[data-group=more]").hidden'), false)
  assert.deepEqual(failures, [])
  console.log(JSON.stringify({ result: 'passed', host: process.platform, appName: app.getName(), menu: presentation.groups,
    isolatedViewport: height - 36, contentOnlyZoom: true, nativePopup: true, narrowOverflow: true }))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  dispose()
  surface.dispose()
  surface.window.destroy()
  rmSync(temporary, { recursive: true, force: true })
  app.exit(process.exitCode ?? 0)
}
}
void smoke().catch(error => { console.error(error); app.exit(1) })
