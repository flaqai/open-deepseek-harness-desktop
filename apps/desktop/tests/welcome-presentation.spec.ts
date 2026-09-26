import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopWelcomePresentation } from '../src/welcome-presentation.ts'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })

async function home(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dsh-welcome-test-'))
  homes.push(path)
  return path
}

const unconfigured = { loggedIn: false, hasApiKey: false }

describe('native welcome presentation record', () => {
  it('shows once for an unconfigured Harness home, including after Later or window close', async () => {
    const directory = await home()
    const first = new DesktopWelcomePresentation(directory)
    expect(await first.shouldPresent(unconfigured)).toBe(true)
    await first.markPresented()
    const nextLaunch = new DesktopWelcomePresentation(directory)
    expect(await nextLaunch.shouldPresent(unconfigured)).toBe(false)
    expect(await new DesktopWelcomePresentation(await home()).shouldPresent(unconfigured)).toBe(true)
  })

  it('does not show for a configured account or key, without marking either as presented', async () => {
    const presentation = new DesktopWelcomePresentation(await home())
    expect(await presentation.shouldPresent({ loggedIn: true, hasApiKey: false })).toBe(false)
    expect(await presentation.shouldPresent({ loggedIn: false, hasApiKey: true })).toBe(false)
    expect(await presentation.shouldPresent(unconfigured)).toBe(true)
  })

  it('rejects a link-shaped or malformed record instead of following or resetting it', async () => {
    const directory = await home()
    const target = join(directory, 'target.json')
    const marker = join(directory, '.open-deepseek-harness-desktop-welcome.json')
    await writeFile(target, '{}')
    await symlink(target, marker)
    await expect(new DesktopWelcomePresentation(directory).wasPresented()).rejects.toThrow('invalid presentation record')
  })
})
