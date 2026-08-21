// Web e2e scenario: the shipped composition discovers local files and cold
// sessions through the real Host, groups both domains in the shared @ menu,
// and projects each pick as a complete inline range without issuing a model call.
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-reference/types'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/reference-composer', import.meta.url))
const MENU_EXPECTED = join(SNAPSHOT_DIR, 'menu.expected.md')
const ORDER_EXPECTED = join(SNAPSHOT_DIR, 'order.expected.md')
const MODE = webSnapshotMode()
const SOURCE_SESSION_ID = 'reference-source-session'
const TARGET_SESSION_ID = 'reference-order-target-session'

/** Build one closed source session with a stable title for reference discovery. */
function sourceSessionFixture(): string {
  const session = Session.create(SessionId(SOURCE_SESSION_ID))
  session.append('turn/start', {
    turn: 1,
  })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Research context for the reference menu.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Research notes',
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return [
    JSON.stringify({
      type: 'session',
      version: SESSION_FORMAT_VERSION,
      id: '{{sessionId}}',
      createdAt: 0,
      cwd: '{{cwd}}',
    }),
    ...session.events.map(event => JSON.stringify(event)),
    '',
  ].join('\n')
}

/** Build one target log with the direct message durably before its recalled context. */
function targetSessionFixture(): string {
  const session = Session.create(SessionId(TARGET_SESSION_ID))
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '@Research notes what changed?' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '## Referenced sessions\n\n<referenced-sessions>snapshot</referenced-sessions>' }],
    source: {
      kind: 'session-reference',
      form: 'recall',
      version: 1,
      references: [{
        sessionId: SOURCE_SESSION_ID,
        label: 'Research notes',
        capturedThroughSeq: 4,
        compacted: false,
        originalMessages: 2,
        retainedMessages: 2,
        omittedMessages: 0,
        omittedBytes: 0,
        truncated: false,
        inputIndex: 0,
      }],
    },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Reference order target',
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return [
    JSON.stringify({
      type: 'session',
      version: SESSION_FORMAT_VERSION,
      id: '{{sessionId}}',
      createdAt: 0,
      cwd: '{{cwd}}',
    }),
    ...session.events.map(event => JSON.stringify(event)),
    '',
  ].join('\n')
}

describe.skipIf(MODE === 'record')('web e2e: file and session references through the real host', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, sourceSessionFixture(), SOURCE_SESSION_ID)
    await seedSession(scaffold, targetSessionFixture(), TARGET_SESSION_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await writeFile(join(scaffold.workspaceCwd, 'workspace', 'reference.txt'), 'reference fixture\n')
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('groups both sources and projects files and sessions as structured inline icon labels', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-reference-composer'))
    const input = page.locator('textarea').first()
    const menu = page.getByRole('listbox', { name: 'Trigger suggestions' })

    await input.fill('@')
    await expect.poll(() => menu.getByRole('option').count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    const snapshot = await captureStableAria(page, '[role="listbox"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(MENU_EXPECTED, snapshot, MODE)
    expect(snapshot).toContain('Files & folders')
    expect(snapshot).toContain('Session conversations')
    expect(snapshot).not.toContain('text: reference Files & folders')
    expect(snapshot).toContain('File \u00b7 reference.txt')
    expect(snapshot).toContain('Session \u00b7 Research notes')
    expect(snapshot).not.toContain('text: Subagents')

    await input.fill('@reference')
    await menu.getByRole('option', { name: /File \u00b7 reference\.txt/ }).click()
    const fileReference = page.locator('[data-reference-appearance="file"]')
    await expect.poll(() => fileReference.textContent()).toBe('@reference.txt')
    await expect.poll(() => fileReference.locator('svg').count()).toBe(1)
    await expect.poll(() => input.inputValue()).toBe('@reference.txt ')

    await input.fill('@Research')
    await menu.getByRole('option', { name: /Session \u00b7 Research notes/ }).click()
    const sessionReference = page.locator('[data-reference-appearance="session"]')
    await expect.poll(() => sessionReference.textContent()).toBe('@Research notes')
    await expect.poll(() => sessionReference.locator('svg').count()).toBe(1)
    await expect.poll(() => input.inputValue()).toBe('@Research notes ')

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })

  it('renders the durable direct-message then recall order', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-reference-order'))
    const group = page.getByRole('treeitem', { name: /Ungrouped/ })
    await group.waitFor({ timeout: 15_000 })
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
    const target = page.getByRole('treeitem').filter({ hasText: /^dsh-web-e2e-ws-/ }).first()
    await target.waitFor({ timeout: 15_000 })
    await target.click()
    await page.getByRole('button', { name: /^Session recall\s*Research notes$/ }).waitFor({ timeout: 15_000 })

    const snapshot = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      .split(TARGET_SESSION_ID).join('{{targetId}}')
    await compareOrRefreshGolden(ORDER_EXPECTED, snapshot, MODE)
    expect(snapshot.indexOf('Research notes what changed?')).toBeLessThan(snapshot.indexOf('Session recall Research notes'))
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['menu.expected.md', 'order.expected.md'])
  })
})
