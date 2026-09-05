/** Durable retry cooldown for bundled plugins that timed out during startup. */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const SCHEMA = 'dsh/bundled-plugin-startup-failures/v1'
const COOLDOWN_MS = 5 * 60_000

interface FailureRecord {
  readonly packageName: string
  readonly version: string
  readonly failedAt: string
}

export class BundledPluginStartupCooldown {
  readonly #path: string
  readonly #now: () => number

  constructor(home: string, now: () => number = Date.now) {
    this.#path = join(home, 'bundled-plugins', 'startup-failures.v1.json')
    this.#now = now
  }

  async shouldAttempt(packageName: string, version: string): Promise<boolean> {
    const failure = (await this.#read()).find(candidate => (
      candidate.packageName === packageName && candidate.version === version
    ))
    return failure === undefined || this.#now() - Date.parse(failure.failedAt) >= COOLDOWN_MS
  }

  async record(packageName: string, version: string): Promise<void> {
    const current = await this.#read()
    await this.#write([
      ...current.filter(candidate => candidate.packageName !== packageName),
      { packageName, version, failedAt: new Date(this.#now()).toISOString() },
    ])
  }

  async clear(packageName: string): Promise<void> {
    const current = await this.#read()
    const retained = current.filter(candidate => candidate.packageName !== packageName)
    if (retained.length !== current.length) await this.#write(retained)
  }

  async #read(): Promise<readonly FailureRecord[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.#path, 'utf8'))
      if (value === null || typeof value !== 'object') return []
      const document = value as Record<string, unknown>
      if (document.schema !== SCHEMA || !Array.isArray(document.failures)) return []
      return document.failures.filter((failure: unknown): failure is FailureRecord => {
        if (failure === null || typeof failure !== 'object') return false
        const record = failure as Record<string, unknown>
        return typeof record.packageName === 'string'
          && typeof record.version === 'string'
          && typeof record.failedAt === 'string'
          && !Number.isNaN(Date.parse(record.failedAt))
      }).slice(-50)
    } catch {
      return []
    }
  }

  async #write(failures: readonly FailureRecord[]): Promise<void> {
    const temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 })
    await writeFile(temporary, `${JSON.stringify({ schema: SCHEMA, failures }, undefined, 2)}\n`, {
      flag: 'wx', mode: 0o600,
    })
    await rename(temporary, this.#path)
  }
}
