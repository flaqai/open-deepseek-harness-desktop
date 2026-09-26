/** Per-Harness-home record for the native welcome's first presentation. */

import { randomUUID } from 'node:crypto'
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { needsWelcome, type WelcomeAuthentication } from './welcome-api.ts'

const SCHEMA = 'open-deepseek-harness-desktop/native-welcome/v1'
const FILE_NAME = '.open-deepseek-harness-desktop-welcome.json'

/** Keep the native welcome independent of account credentials and community onboarding. */
export class DesktopWelcomePresentation {
  readonly #path: string

  /** @param dshHome - selected local Harness home, not Electron's shared userData. */
  constructor(dshHome: string) {
    this.#path = join(dshHome, FILE_NAME)
  }

  /** @returns whether this Harness home has already shown the native welcome. */
  async wasPresented(): Promise<boolean> {
    try {
      const metadata = await lstat(this.#path)
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('desktop welcome: invalid presentation record')
      const parsed: unknown = JSON.parse(await readFile(this.#path, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null || !('schema' in parsed) || parsed.schema !== SCHEMA) {
        throw new Error('desktop welcome: invalid presentation record')
      }
      return true
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false
      throw error
    }
  }

  /** @param authentication - safe account and key-presence facts for the selected home. */
  async shouldPresent(authentication: WelcomeAuthentication): Promise<boolean> {
    if (!needsWelcome(authentication)) return false
    return needsWelcome({ ...authentication, wasPresented: await this.wasPresented() })
  }

  /** Record presentation atomically before showing the loaded native renderer. */
  async markPresented(): Promise<void> {
    const temporary = `${this.#path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify({ schema: SCHEMA })}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await rename(temporary, this.#path)
    } finally {
      await rm(temporary, { force: true })
    }
  }
}
