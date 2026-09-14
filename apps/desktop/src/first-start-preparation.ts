/** Durable first-start gate, independent of partially initialized Profile files. */
import { lstat, mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export class FirstStartPreparation {
  readonly #path: string

  constructor(home: string) {
    this.#path = join(home, 'bundled-plugins', 'first-start.pending')
  }

  /**
   * Retain the gate before initialization writes any Profile files.
   * @param initialize - Whether this is a new desktop-managed Profile.
   * @returns Whether full preparation is still required, including after interruption.
   */
  async begin(initialize: boolean): Promise<boolean> {
    if (initialize) {
      await mkdir(dirname(this.#path), { recursive: true })
      try { await writeFile(this.#path, '', { flag: 'wx', mode: 0o600 }) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    try {
      if (!(await lstat(this.#path)).isFile()) throw new Error('desktop: invalid first-start preparation marker')
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  /** Remove the gate only after the complete candidate has started and committed. */
  async complete(): Promise<void> {
    await unlink(this.#path)
  }
}
