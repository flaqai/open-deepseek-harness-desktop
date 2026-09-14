/** Bounded, timestamped logging for Desktop and Harness process output. */

import {
  appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { format } from 'node:util'

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
const DEFAULT_BACKUPS = 4
const MAX_ENTRY_CHARS = 64 * 1024

/** Rotation settings applied before the first writer opens the current log. */
export interface PersistentLogRetention {
  readonly maxBytes?: number
  readonly backups?: number
}

/** Metadata written once for each Desktop process lifetime. */
export interface DesktopLogSessionMetadata {
  readonly sessionId: string
  readonly version: string
  readonly platform: NodeJS.Platform
  readonly architecture: string
  readonly packaged: boolean
  readonly pid: number
}

function archivePath(path: string, index: number): string {
  return `${path}.${index}`
}

/** Rotate an oversized current log while retaining a bounded restart history. */
export function preparePersistentLog(path: string, retention: PersistentLogRetention = {}): void {
  const maxBytes = retention.maxBytes ?? DEFAULT_MAX_BYTES
  const backups = retention.backups ?? DEFAULT_BACKUPS
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('desktop: log maxBytes must be a positive integer')
  if (!Number.isSafeInteger(backups) || backups < 1) throw new TypeError('desktop: log backups must be a positive integer')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (!existsSync(path) || statSync(path).size < maxBytes) return
  const oldest = archivePath(path, backups)
  if (existsSync(oldest)) unlinkSync(oldest)
  for (let index = backups - 1; index >= 1; index -= 1) {
    const from = archivePath(path, index)
    if (existsSync(from)) renameSync(from, archivePath(path, index + 1))
  }
  renameSync(path, archivePath(path, 1))
}

/** Remove common credential forms before diagnostic text reaches durable storage. */
export function redactPersistentLogText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/giu, '$1[REDACTED]')
    .replace(/([?&](?:access_token|api[_-]?key|auth|password|secret|token)=)[^&#\s]*/giu, '$1[REDACTED]')
    .replace(/\b((?:API_KEY|AUTH_TOKEN|PASSWORD|SECRET|TOKEN)\s*=\s*)[^\s]+/giu, '$1[REDACTED]')
    .replace(/(https?:\/\/[^\s/:@]+:)[^\s/@]+@/giu, '$1[REDACTED]@')
}

/** Format one complete durable log line with time, source, and severity. */
export function formatPersistentLogLine(
  source: string,
  level: string,
  message: string,
  now: Date = new Date(),
): string {
  const normalized = redactPersistentLogText(message.replace(/[\r\n]+$/u, ''))
  const bounded = normalized.length > MAX_ENTRY_CHARS
    ? `${normalized.slice(0, MAX_ENTRY_CHARS)}… [entry truncated]`
    : normalized
  const prefix = `[${now.toISOString()}] [${source}] [${level}] `
  return bounded.split(/\r?\n/u).map(line => `${prefix}${line}\n`).join('')
}

/** Incrementally timestamp complete lines from a process pipe. */
export class TimestampedLogWriter {
  readonly #write: (line: string) => void
  readonly #source: string
  readonly #level: string
  readonly #now: () => Date
  readonly #decoder = new StringDecoder('utf8')
  #pending = ''

  constructor(
    write: (line: string) => void,
    source: string,
    level = 'info',
    now: () => Date = () => new Date(),
  ) {
    this.#write = write
    this.#source = source
    this.#level = level
    this.#now = now
  }

  /** Add a UTF-8 process-output chunk and persist every complete line. */
  write(chunk: Buffer | string): void {
    this.#pending += typeof chunk === 'string' ? chunk : this.#decoder.write(chunk)
    const lines = this.#pending.split(/\r?\n/u)
    this.#pending = lines.pop() ?? ''
    for (const line of lines) this.#write(formatPersistentLogLine(this.#source, this.#level, line, this.#now()))
  }

  /** Persist the final unterminated line, if present. */
  flush(): void {
    this.#pending += this.#decoder.end()
    if (this.#pending === '') return
    this.#write(formatPersistentLogLine(this.#source, this.#level, this.#pending, this.#now()))
    this.#pending = ''
  }
}

/** Handle for the console capture installed for one Desktop process lifetime. */
export interface DesktopLogSession {
  append(source: string, level: string, message: string): void
  close(reason: string): void
}

/**
 * Append Desktop console output to the fixed diagnostic log without suppressing its original destination.
 * Logging failures never replace or terminate the application operation being diagnosed.
 */
export function startDesktopLogSession(
  path: string,
  metadata: DesktopLogSessionMetadata,
  retention: PersistentLogRetention = {},
): DesktopLogSession {
  const original = {
    debug: console.debug.bind(console), error: console.error.bind(console), info: console.info.bind(console),
    log: console.log.bind(console), warn: console.warn.bind(console),
  }
  let writable = true
  let closed = false
  const append = (source: string, level: string, message: string): void => {
    if (!writable || closed) return
    try {
      appendFileSync(path, formatPersistentLogLine(source, level, message), { encoding: 'utf8', mode: 0o600 })
    } catch (error) {
      writable = false
      original.error('desktop: persistent diagnostic log is unavailable', error)
    }
  }

  try {
    preparePersistentLog(path, retention)
  } catch (error) {
    writable = false
    original.error('desktop: persistent diagnostic log could not be prepared', error)
  }
  append('desktop', 'info', `session started id=${metadata.sessionId} version=${metadata.version} platform=${metadata.platform} architecture=${metadata.architecture} packaged=${String(metadata.packaged)} pid=${metadata.pid}`)

  const install = (level: keyof typeof original): void => {
    console[level] = (...args: unknown[]): void => {
      original[level](...args)
      append('desktop', level, format(...args))
    }
  }
  install('debug')
  install('error')
  install('info')
  install('log')
  install('warn')

  return {
    append,
    close: (reason) => {
      if (closed) return
      append('desktop', 'info', `session ended reason=${reason}`)
      closed = true
      console.debug = original.debug
      console.error = original.error
      console.info = original.info
      console.log = original.log
      console.warn = original.warn
    },
  }
}
