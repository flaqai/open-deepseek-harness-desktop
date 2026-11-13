/** Browser download operations and FIFO modal state shared by menu actions and `/export`. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SESSION_LOG_EXPORT_ROUTE } from '../routes.ts'

/** Download phases presented by the shared modal. */
export type SessionLogDownloadStatus = 'confirming' | 'downloading' | 'success' | 'error'

/** One Session's current download-dialog state. */
export interface SessionLogDownloadEntry {
  /** Initiation order of this operation; repeated in-flight requests keep it. */
  readonly order: number
  readonly open: boolean
  readonly status: SessionLogDownloadStatus
  readonly error: string | null
  readonly includeCustomInstructions?: boolean
  readonly remember?: boolean
}

/** Authoritative download states; open entries display in initiation order across Sessions. */
export interface SessionLogDownloadState {
  bySession: Record<string, SessionLogDownloadEntry | undefined>
}

/** HTTP carrier for the export route. */
type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>
type Save = (url: string, filename: string) => void

/** Remembered plaintext-disclosure policy supplied by trusted Settings UI. */
export interface SessionLogExportPrivacy {
  getPreference: () => 'ask' | 'include' | 'exclude'
  setPreference: (preference: 'include' | 'exclude') => Promise<void>
}

const INITIAL: SessionLogDownloadState = { bySession: {} }

/**
 * Collapse an untrusted Session id into the filename convention owned by the host endpoint.
 * @param sessionId - Session whose archive is downloaded.
 * @returns one safe browser download filename.
 */
export function sessionLogZipFilename(sessionId: SessionId): string {
  return `dsh-session-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.zip`
}

/**
 * Hand a Host download route to the browser download manager, which resolves it
 * against the document's own base.
 * @param url - document-relative Host download route.
 * @param filename - browser download filename.
 */
export function downloadUrl(url: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Owns one in-flight browser download per Session and publishes modal state. */
export class SessionLogDownloadController {
  /** Stable snapshot source for the root modal and menu availability. */
  readonly store: SnapshotStore<SessionLogDownloadState> = createSnapshotStore(INITIAL)

  private readonly active = new Map<SessionId, { readonly abort: AbortController; readonly done: Promise<void> }>()
  private disposed = false
  private nextOrder = 0

  /**
   * @param fetcher - HTTP carrier used to read the host-streamed ZIP.
   * @param save - browser save operation.
   */
  constructor(
    private readonly fetcher: Fetch = (input, init) => fetch(input, init),
    private readonly save: Save = downloadUrl,
    private readonly privacy?: SessionLogExportPrivacy,
  ) {}

  /**
   * Download one Session tree; concurrent gestures for the same Session share one operation.
   * Different Sessions run concurrently; each new operation joins the modal FIFO.
   * @param sessionId - root Session whose ZIP includes descendants and attachments.
   * @returns after the browser save starts, an error state is published, or a late post-disposal request is ignored.
   */
  download(sessionId: SessionId): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const active = this.active.get(sessionId)
    if (active !== undefined) return active.done
    const current = this.store.getSnapshot().bySession[sessionId]
    if (current?.status === 'confirming' && current.open) return Promise.resolve()
    const preference = this.privacy?.getPreference()
    if (preference === 'ask') {
      this.publish(sessionId, {
        order: this.nextOrder++,
        open: true,
        status: 'confirming',
        error: null,
        includeCustomInstructions: false,
        remember: false,
      })
      return Promise.resolve()
    }
    return this.start(sessionId, preference === 'include')
  }

  /**
   * Change the one-shot disclosure choice while the confirmation is open.
   * @param sessionId - Session whose confirmation is being edited.
   * @param include - whether this export should retain custom-prompt plaintext.
   */
  setIncludeCustomInstructions(sessionId: SessionId, include: boolean): void {
    const current = this.store.getSnapshot().bySession[String(sessionId)]
    if (current?.status !== 'confirming') return
    this.publish(sessionId, { ...current, includeCustomInstructions: include })
  }

  /**
   * Remember (or stop remembering) the current disclosure choice.
   * @param sessionId - Session whose confirmation is being edited.
   * @param remember - whether to persist the exact include/exclude selection.
   */
  setRemember(sessionId: SessionId, remember: boolean): void {
    const current = this.store.getSnapshot().bySession[String(sessionId)]
    if (current?.status !== 'confirming') return
    this.publish(sessionId, { ...current, remember })
  }

  /**
   * Accept the disclosure dialog and begin the Host download.
   * @param sessionId - Session whose confirmed export should start.
   */
  async confirm(sessionId: SessionId): Promise<void> {
    const current = this.store.getSnapshot().bySession[String(sessionId)]
    if (this.disposed || current?.status !== 'confirming' || !current.open) return
    const include = current.includeCustomInstructions === true
    if (current.remember === true) {
      try {
        await this.privacy?.setPreference(include ? 'include' : 'exclude')
      } catch (error) {
        if (this.store.getSnapshot().bySession[sessionId] === current) {
          this.publish(sessionId, { ...current, status: 'error', error: messageOf(error) })
        }
        return
      }
    }
    if (this.store.getSnapshot().bySession[sessionId] !== current) return
    await this.start(sessionId, include, current.order)
  }

  private start(sessionId: SessionId, includeCustomInstructions: boolean, order = this.nextOrder++): Promise<void> {
    const existing = this.active.get(sessionId)
    if (existing !== undefined) return existing.done
    if (this.disposed) return Promise.resolve()
    const abort = new AbortController()
    const done = this.run(sessionId, includeCustomInstructions, abort.signal, order).finally(() => {
      this.active.delete(sessionId)
    })
    this.active.set(sessionId, { abort, done })
    return done
  }

  /**
   * Close one Session's dialog without cancelling an in-flight browser download.
   * @param sessionId - Session whose modal closes.
   */
  dismiss(sessionId: SessionId): void {
    const current = this.store.getSnapshot().bySession[String(sessionId)]
    if (current === undefined || !current.open) return
    this.publish(sessionId, { ...current, open: false })
  }

  /**
   * Abort active fetches and reach quiescence.
   * @returns after every active operation settles.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    const active = [...this.active.values()]
    for (const operation of active) operation.abort.abort()
    await Promise.allSettled(active.map(operation => operation.done))
  }

  private async run(sessionId: SessionId, includeCustomInstructions: boolean, signal: AbortSignal, order: number): Promise<void> {
    this.publish(sessionId, { order, open: true, status: 'downloading', error: null })
    try {
      const query = new URLSearchParams({
        sessionId, includeDescendants: 'true', includeCustomInstructions: String(includeCustomInstructions),
      })
      const route = `${SESSION_LOG_EXPORT_ROUTE}?${query.toString()}`
      const response = await this.fetcher(route, { method: 'HEAD', signal })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`Export failed: HTTP ${response.status}${detail === '' ? '' : ` ${detail}`}`)
      }
      if (signal.aborted) return
      this.save(route, sessionLogZipFilename(sessionId))
      const open = this.store.getSnapshot().bySession[String(sessionId)]?.open ?? true
      this.publish(sessionId, { order, open, status: 'success', error: null })
    } catch (error: unknown) {
      if (signal.aborted) return
      const open = this.store.getSnapshot().bySession[String(sessionId)]?.open ?? true
      this.publish(sessionId, { order, open, status: 'error', error: messageOf(error) })
    }
  }

  private publish(sessionId: SessionId, entry: SessionLogDownloadEntry): void {
    this.store.update((state) => {
      state.bySession = { ...state.bySession, [String(sessionId)]: entry }
    })
  }
}
