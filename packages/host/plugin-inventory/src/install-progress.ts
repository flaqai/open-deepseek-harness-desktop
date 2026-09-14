/** Private parsing and bounded presentation for observed pnpm installs. */

import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import type {
  PluginInstallOutputRead,
  PluginInstallProgress,
  PluginInstallProgressStage,
} from './types.ts'

const MAX_PRESENTATION_LINE_BYTES = 8 * 1024

interface RetainedLine {
  readonly start: number
  readonly end: number
  readonly text: string
}

interface PnpmLog {
  readonly name?: unknown
  readonly stage?: unknown
  readonly status?: unknown
  readonly packageId?: unknown
  readonly downloaded?: unknown
  readonly size?: unknown
  readonly message?: unknown
  readonly attempt?: unknown
  readonly maxRetries?: unknown
  readonly timeout?: unknown
  readonly error?: unknown
}

function finiteCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function safeTail(text: string, maxBytes = MAX_PRESENTATION_LINE_BYTES): string {
  const encoded = Buffer.from(text)
  if (encoded.byteLength <= maxBytes) return text
  const marker = Buffer.from('…')
  if (maxBytes <= marker.byteLength) return ''
  let start = encoded.byteLength - (maxBytes - marker.byteLength)
  while (start < encoded.byteLength && (encoded[start] ?? 0) >= 0x80 && (encoded[start] ?? 0) < 0xc0) start += 1
  return `${marker.toString('utf8')}${encoded.subarray(start).toString('utf8')}`
}

/**
 * Remove credential-shaped material before installer output crosses to the browser.
 * @param value - Raw package-manager or CLI output.
 * @returns Output with recognized URL, token, authorization, and password values redacted.
 */
export function redactInstallOutput(value: string): string {
  return value
    .replace(/\b(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/giu, '$1[redacted]@')
    .replace(/([?&](?:access_token|auth|key|password|signature|token)=)[^\s&#]*/giu, '$1[redacted]')
    .replace(/((?:^|\s|\/\/[^\s:=]+\/?:)(?:_auth(?:Token)?|npm_token|node_auth_token|npm_config_+auth(?:Token)?)\s*[:=]\s*)[^\s,;]+/gimu, '$1[redacted]')
    .replace(/\b((?:authorization|access_token|auth_token|token|password)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/giu, '$1[redacted]')
}

function displayBytes(value: number): string {
  if (value < 1024) return `${String(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

function nestedMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  return nestedMessage(record.message) ?? nestedMessage(record.code)
}

/** One job's incremental NDJSON parser and bounded, sanitized terminal transcript. */
export class InstallProgressTracker {
  private readonly decoder = new StringDecoder('utf8')
  private readonly lines: RetainedLine[] = []
  private fileOffset = 0
  private outputOffset = 0
  private retainedBytes = 0
  private pending = ''
  private resolved = 0
  private acquired = 0
  private imported = 0
  private resolutionDone = false
  private stage: PluginInstallProgressStage = 'preparing'

  constructor(private readonly maxBytes: number) {}

  /** Current coarse stage and truthful determinate counters, when available. */
  get progress(): PluginInstallProgress {
    if ((this.stage === 'downloading' || this.stage === 'installing') && this.resolutionDone && this.resolved > 0) {
      const completed = Math.min(this.stage === 'installing' ? this.imported : this.acquired, this.resolved)
      return {
        stage: this.stage,
        percent: Math.min(99, Math.floor(completed / this.resolved * 100)),
        completed,
        total: this.resolved,
      }
    }
    return { stage: this.stage }
  }

  /**
   * Read and parse bytes appended since the previous refresh.
   * @param path - Host-created private NDJSON sidecar for this install.
   */
  refresh(path: string): void {
    let size: number
    try {
      size = statSync(path).size
    } catch {
      return
    }
    if (size <= this.fileOffset) return
    const fd = openSync(path, 'r')
    try {
      while (this.fileOffset < size) {
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, size - this.fileOffset))
        const read = readSync(fd, buffer, 0, buffer.byteLength, this.fileOffset)
        if (read === 0) break
        this.fileOffset += read
        this.consume(this.decoder.write(buffer.subarray(0, read)))
      }
    } finally {
      closeSync(fd)
    }
  }

  /**
   * Flush a final partial line after the observed process has settled.
   * @param success - Whether the guarded install reached successful verification.
   */
  settle(success: boolean): void {
    const decoded = this.decoder.end()
    if (decoded !== '') this.consume(decoded)
    if (this.pending !== '') {
      this.consumeLine(this.pending)
      this.pending = ''
    }
    if (success) {
      this.stage = 'verifying'
    }
  }

  /**
   * Append ordinary CLI output that was not part of pnpm's reporter stream.
   * @param text - Bounded subprocess diagnostic to sanitize and retain.
   */
  appendDiagnostic(text: string): void {
    const normalized = redactInstallOutput(text).trim()
    if (normalized !== '') this.append(`${normalized}\n`)
  }

  /**
   * Read sanitized output by the opaque byte cursor returned to this client.
   * @param offset - Byte cursor from the preceding read, or zero for the first read.
   * @param settled - Whether the owning install has reached a terminal phase.
   * @returns Incremental output, next cursor, truncation state, and settlement state.
   */
  read(offset: number, settled: boolean): PluginInstallOutputRead {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError('pluginInventory: invalid install output offset')
    const retainedStart = this.lines[0]?.start ?? this.outputOffset
    const lossy = offset < retainedStart || offset > this.outputOffset
    const from = lossy ? retainedStart : offset
    const matchingBoundary = from === this.outputOffset || this.lines.some(line => line.start === from)
    const effectiveFrom = matchingBoundary ? from : retainedStart
    return {
      text: this.lines.filter(line => line.start >= effectiveFrom).map(line => line.text).join(''),
      nextOffset: this.outputOffset,
      lossy: lossy || !matchingBoundary,
      settled,
    }
  }

  private consume(text: string): void {
    const combined = this.pending + text
    const parts = combined.split(/\r?\n/u)
    this.pending = parts.pop() ?? ''
    for (const line of parts) this.consumeLine(line)
  }

  private consumeLine(line: string): void {
    if (line.trim() === '') return
    let log: PnpmLog
    try {
      log = JSON.parse(line) as PnpmLog
    } catch {
      this.append(`${safeTail(redactInstallOutput(line))}\n`)
      return
    }
    const name = typeof log.name === 'string' ? log.name : ''
    if (name === 'dsh:install-progress') {
      if (log.stage === 'attempt-started') {
        this.resetAttempt()
        const attempt = finiteCount(log.attempt)
        this.append(`Starting download${attempt === undefined ? '' : ` attempt ${String(attempt)}`}…\n`)
      } else if (log.stage === 'retrying') {
        this.stage = 'preparing'
        this.append(`${redactInstallOutput(typeof log.message === 'string' ? log.message : 'Retrying download…')}\n`)
      }
      return
    }
    if (name === 'pnpm:stage') {
      if (log.stage === 'resolution_started') this.setStage('resolving', 'Resolving dependencies…')
      else if (log.stage === 'resolution_done') {
        this.resolutionDone = true
        this.setStage('downloading', 'Downloading dependencies…')
        this.appendProgress()
      } else if (log.stage === 'importing_started') {
        this.setStage('installing', 'Installing dependencies…')
        this.appendProgress()
      }
      else if (log.stage === 'importing_done') this.setStage('verifying', 'Verifying installation…')
      return
    }
    if (name === 'pnpm:progress') {
      if (log.status === 'resolved') {
        this.resolved += 1
        if (this.stage === 'downloading') this.appendProgress()
      } else if (log.status === 'fetched' || log.status === 'found_in_store') {
        this.acquired += 1
        if (this.stage === 'downloading') this.appendProgress()
      } else if (log.status === 'imported') {
        this.imported += 1
        if (this.stage === 'installing') this.appendProgress()
      }
      return
    }
    if (name === 'pnpm:fetching-progress') {
      const packageId = typeof log.packageId === 'string' ? redactInstallOutput(log.packageId) : 'package'
      const downloaded = finiteCount(log.downloaded)
      const size = finiteCount(log.size)
      if (log.status === 'started' && size !== undefined) {
        this.append(`Downloading ${packageId} (${displayBytes(size)}).\n`)
      } else if (log.status === 'in_progress' && downloaded !== undefined) {
        this.append(`Downloading ${packageId}: ${displayBytes(downloaded)}.\n`)
      }
      return
    }
    if (name === 'pnpm:request-retry') {
      const message = typeof log.message === 'string' ? log.message : nestedMessage(log.error)
      if (message !== undefined) this.append(`${safeTail(redactInstallOutput(message))}\n`)
      return
    }
    const message = typeof log.message === 'string' ? log.message : nestedMessage(log.error)
    if (message !== undefined) this.append(`${safeTail(redactInstallOutput(message))}\n`)
  }

  private setStage(stage: PluginInstallProgressStage, message: string): void {
    if (this.stage === stage) return
    this.stage = stage
    this.append(`${message}\n`)
  }

  private resetAttempt(): void {
    this.stage = 'preparing'
    this.resolved = 0
    this.acquired = 0
    this.imported = 0
    this.resolutionDone = false
  }

  private appendProgress(): void {
    if (!this.resolutionDone || this.resolved === 0) return
    if (this.stage !== 'downloading' && this.stage !== 'installing') return
    const progress = this.progress
    const label = this.stage === 'installing' ? 'installed' : 'ready'
    this.append(`Progress: ${String(progress.completed ?? 0)}/${String(progress.total ?? this.resolved)} dependencies ${label} (${String(progress.percent ?? 0)}%).\n`)
  }

  private append(value: string): void {
    const text = safeTail(value, this.maxBytes)
    const bytes = Buffer.byteLength(text)
    const line = { start: this.outputOffset, end: this.outputOffset + bytes, text }
    this.outputOffset = line.end
    this.lines.push(line)
    this.retainedBytes += bytes
    while (this.retainedBytes > this.maxBytes && this.lines.length > 1) {
      const removed = this.lines.shift()
      if (removed !== undefined) this.retainedBytes -= removed.end - removed.start
    }
  }
}
