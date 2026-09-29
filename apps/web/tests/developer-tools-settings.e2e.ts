/** Developer tools default on for a fresh Host and survive browser reload through the ordinary settings UI. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from './scaffold.ts'
import { openSettings, newEnglishPage } from './support.ts'

it('persists developer tools in the Host settings document and restores the accepted choice', async () => {
  const scaffold = await launchWebScaffold()
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  await page.goto(scaffold.authenticatedUrl)
  await openSettings(page, 'en')
  const toggle = page.getByRole('switch', { name: 'Show coding view' })
  expect(await toggle.getAttribute('aria-checked')).toBe('true')
  expect(await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')).not.toMatch(/id: ui-settings(?:\r?\n|$)/)
  await toggle.click()
  await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')
  expect(await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')).toContain('enabled: false')
  await page.reload()
  await openSettings(page, 'en')
  await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')

  await page.getByRole('button', { name: 'Agent presets', exact: true }).click()
  await expect.poll(() => page.getByRole('heading', { name: 'Agent presets', exact: true }).count()).toBe(1)
  // The page owns no selection switch; the cards and the Creator entry stay usable with Coding Tools off.
  const section = page.locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Agent presets', exact: true }) })
  const setDefault = section.getByRole('button', { name: 'Set as new task default: Minimal mode' })
  expect(await section.getByRole('switch').count()).toBe(0)
  await expect.poll(() => setDefault.isEnabled()).toBe(true)
  expect(await section.getByRole('button', { name: 'Let the agent help me create a preset', exact: true }).isEnabled()).toBe(true)
  await scaffold.ctx.settings.update('ui-settings', { enabled: true })
  await expect.poll(() => setDefault.isEnabled()).toBe(true)
  expect(await section.getByRole('switch').count()).toBe(0)
})
