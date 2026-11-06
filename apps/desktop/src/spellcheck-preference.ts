/** Local spelling preference; enabling never changes dictionary download routing. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
/** Persist the device-local spelling toggle independently of the shared Profile. */
export class SpellcheckPreference {
  #enabled = true
  constructor(private readonly path: string) {
    try {
      const data: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (typeof data === 'object' && data !== null && 'enabled' in data && typeof data.enabled === 'boolean') this.#enabled = data.enabled
    } catch { /* First launch or an unreadable preference retains the local default. */ }
  }
  /** Current saved choice; availability is checked separately. */
  get enabled(): boolean { return this.#enabled }
  /** Save before changing the active session. @param enabled New local preference. */
  set(enabled: boolean): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify({ version: 1, enabled })}\n`, { mode: 0o600 })
    renameSync(temporary, this.path)
    this.#enabled = enabled
  }
}
