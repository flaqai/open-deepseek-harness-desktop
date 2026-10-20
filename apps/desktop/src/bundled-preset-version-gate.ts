/** Per-Profile retry budget and committed completion for automatic preset preparation. */

import { lstat, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { gt, valid } from 'semver'

const SCHEMA = 2
const MAX_ATTEMPTS = 3
const FILE = 'desktop-preset-attempt.v1.json'

interface PreparationRecord {
  schema: 2
  attemptedVersion: string
  attemptCount: number
  completed: boolean
}

/** Callers serialize marker mutations across the desktop startup lifecycle. */
export class BundledPresetVersionGate {
  readonly #path: string

  constructor(home: string) {
    this.#path = join(home, 'bundled-plugins', FILE)
  }

  /** Permit at most three incomplete attempts per version; completed or newer versions are never retried. */
  async shouldAttempt(version: string): Promise<boolean> {
    const record = await this.#read(version)
    if (!record || gt(version, record.attemptedVersion)) return true
    return !gt(record.attemptedVersion, version) && !record.completed && record.attemptCount < MAX_ATTEMPTS
  }

  /** Report exhausted incomplete attempts only for the requested version, for persistent repair guidance. */
  async retryExhausted(version: string): Promise<boolean> {
    const record = await this.#read(version)
    return !!record && !gt(version, record.attemptedVersion) && !gt(record.attemptedVersion, version)
      && !record.completed && record.attemptCount >= MAX_ATTEMPTS
  }

  /** Persist before preparation; failures and interruptions consume one attempt without implying completion. */
  async markAttempted(version: string): Promise<void> {
    const record = await this.#read(version)
    if (record && gt(record.attemptedVersion, version)) throw new Error('desktop: preset preparation cannot downgrade')
    const sameVersion = record && !gt(version, record.attemptedVersion)
    if (sameVersion && record.completed) throw new Error('desktop: preset preparation already completed')
    if (sameVersion && record.attemptCount >= MAX_ATTEMPTS) throw new Error('desktop: preset preparation retry budget exhausted')
    await this.#write({
      schema: SCHEMA, attemptedVersion: version,
      attemptCount: sameVersion ? record.attemptCount + 1 : 1, completed: false,
    })
  }

  /** Persist only after activation commits every required preset; also supports successful first-start deployment. */
  async markCompleted(version: string): Promise<void> {
    const record = await this.#read(version)
    if (record && gt(record.attemptedVersion, version)) throw new Error('desktop: preset preparation cannot downgrade')
    await this.#write({
      schema: SCHEMA, attemptedVersion: version,
      attemptCount: record && !gt(version, record.attemptedVersion) ? record.attemptCount : 0,
      completed: true,
    })
  }

  async #read(version: string): Promise<PreparationRecord | null> {
    if (valid(version) === null) throw new Error('desktop: invalid application version for preset preparation')
    let source: string
    try {
      if (!(await lstat(this.#path)).isFile()) throw new Error('desktop: invalid preset preparation marker')
      source = await readFile(this.#path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    let record: unknown
    try { record = JSON.parse(source) } catch {
      throw new Error('desktop: invalid preset preparation marker')
    }
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('desktop: invalid preset preparation marker')
    }
    const value = record as Record<string, unknown>
    if (typeof value.attemptedVersion !== 'string' || valid(value.attemptedVersion) === null) {
      throw new Error('desktop: invalid preset preparation marker')
    }
    const keys = Object.keys(record).sort().join(',')
    if (value.schema === 1 && keys === 'attemptedVersion,schema') {
      return { schema: SCHEMA, attemptedVersion: value.attemptedVersion, attemptCount: 1, completed: false }
    }
    if (value.schema !== SCHEMA || keys !== 'attemptCount,attemptedVersion,completed,schema'
      || typeof value.attemptCount !== 'number' || !Number.isInteger(value.attemptCount)
      || value.attemptCount < 0 || value.attemptCount > MAX_ATTEMPTS
      || typeof value.completed !== 'boolean' || (value.attemptCount === 0 && !value.completed)) {
      throw new Error('desktop: invalid preset preparation marker')
    }
    return {
      schema: SCHEMA, attemptedVersion: value.attemptedVersion,
      attemptCount: value.attemptCount, completed: value.completed,
    }
  }

  async #write(record: PreparationRecord): Promise<void> {
    const directory = dirname(this.#path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    if (!(await lstat(directory)).isDirectory()) throw new Error('desktop: invalid preset preparation directory')
    await writeFileAtomic(this.#path, `${JSON.stringify(record)}\n`, { mode: 0o600, dirMode: 0o700 })
  }
}
