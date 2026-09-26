/** Native confirmation before an ordinary desktop quit interrupts Host work. */

import type { MessageBoxOptions, MessageBoxReturnValue, NativeImage } from 'electron'
import { shellMessages } from './locales/shell.ts'

/** Host facts relevant to quitting, including enabled reminders in its persisted catalog. */
export interface DesktopQuitInspection {
  readonly activeTasks: boolean
  readonly scheduledTasks: boolean
}

/** Why an ordinary quit needs confirmation. */
export type DesktopQuitPrompt = 'active' | 'scheduled' | 'both' | 'unknown' | undefined

/** @param result - Host answer, or unknown after a failed inspection. @returns The warning to show. */
export function resolveDesktopQuitPrompt(result: DesktopQuitInspection | 'unknown'): DesktopQuitPrompt {
  if (result === 'unknown') return 'unknown'
  if (result.activeTasks && result.scheduledTasks) return 'both'
  if (result.activeTasks) return 'active'
  if (result.scheduledTasks) return 'scheduled'
  return undefined
}

/** Dependencies supplied by the community Electron shell. */
export interface DesktopQuitConfirmationOptions {
  /** `undefined` means the Host has not started, so it cannot be running tasks. A ready but unreachable Host must reject. */
  readonly inspect: () => Promise<DesktopQuitInspection> | undefined
  readonly show: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>
  readonly locale: () => string
  readonly focus?: () => void
  readonly platform?: NodeJS.Platform
  readonly icon?: NativeImage
  readonly inspectionTimeoutMs?: number
}

/** Serializes ordinary quit decisions and ignores answers superseded by a restart. */
export class DesktopQuitConfirmation {
  private pending: Promise<boolean> | undefined
  private revision = 0

  /** @param options - Host inspection and native dialog collaborators. */
  constructor(private readonly options: DesktopQuitConfirmationOptions) {}

  /** @returns Whether this ordinary quit may proceed. */
  confirm(): Promise<boolean> {
    if (this.pending !== undefined) {
      this.options.focus?.()
      return this.pending
    }
    const revision = this.revision
    const pending = this.decide(revision).finally(() => {
      if (this.pending === pending) this.pending = undefined
    })
    this.pending = pending
    return pending
  }

  /** Invalidate a pending ordinary decision when a separate, authorized restart takes over. */
  cancelPending(): void { this.revision++ }

  private async inspect(): Promise<DesktopQuitInspection | 'unknown' | undefined> {
    try {
      const inspection = this.options.inspect()
      if (inspection === undefined) return undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          inspection,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => { reject(new Error('desktop quit: task inspection timed out')) }, this.options.inspectionTimeoutMs ?? 2000)
          }),
        ])
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    } catch (error) {
      console.warn('desktop quit: task inspection unavailable', error)
      return 'unknown'
    }
  }

  private async decide(revision: number): Promise<boolean> {
    const inspection = await this.inspect()
    if (revision !== this.revision) return false
    if (inspection === undefined) return true
    const prompt = resolveDesktopQuitPrompt(inspection)
    if (prompt === undefined) return true
    const copy = shellMessages(this.options.locale())
    const windows = (this.options.platform ?? process.platform) === 'win32'
    try {
      const result = await this.options.show({
        type: windows ? 'none' : 'warning',
        ...(windows && this.options.icon !== undefined ? { icon: this.options.icon } : {}),
        title: copy.productName,
        message: copy.quitTitle,
        detail: prompt === 'both' ? copy.quitActiveAndScheduledTasks
          : prompt === 'active' ? copy.quitActiveTasks
            : prompt === 'scheduled' ? copy.quitScheduledTasks : copy.quitTaskStatusUnknown,
        buttons: [copy.quit, copy.cancel],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      return revision === this.revision && result.response === 0
    } catch (error) {
      console.error('desktop quit: confirmation unavailable', error)
      return false
    }
  }
}
