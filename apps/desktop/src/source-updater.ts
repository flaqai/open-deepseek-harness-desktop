/** Safe source-checkout updates from the official DeepSeek Harness stable branch. */

import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

/** Official source used by the desktop source updater. */
const OFFICIAL_HARNESS_REPOSITORY = 'https://github.com/deepseek-ai/deepseek-harness.git'
/** Official branch treated as stable until the upstream publishes a release channel. */
const OFFICIAL_HARNESS_BRANCH = 'master'

const GIT_TIMEOUT_MS = 90_000
const PREPARE_TIMEOUT_MS = 15 * 60_000
const OUTPUT_LIMIT = 64 * 1024

/** Why a checked source cannot immediately update. */
export type SourceUpdateReason =
  | 'ready'
  | 'current'
  | 'dirty'
  | 'diverged'
  | 'not-source-checkout'
  | 'check-failed'

/** Immutable result of checking the official stable branch. */
export interface SourceUpdateStatus {
  repository: string
  branch: string
  reason: SourceUpdateReason
  currentCommit?: string
  latestCommit?: string
  dirtyFiles: number
  detail?: string
}

/** Result of a confirmed source update. */
export type SourceUpdateResult =
  | { ok: true; previousCommit: string; currentCommit: string; restartRequired: true }
  | { ok: false; status: SourceUpdateStatus; rollbackIncomplete?: boolean }

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

/** Injectable process execution for deterministic updater tests. */
export type SourceUpdateRunner = (
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
) => Promise<CommandResult>

/** Updater construction options. */
export interface SourceUpdaterOptions {
  sourceRoot: string
  nodeCommand: string
  gitCommand?: string
  repository?: string
  branch?: string
  runner?: SourceUpdateRunner
  prepare?: (sourceRoot: string) => Promise<void>
}

function appendBounded(current: string, chunk: Buffer): string {
  const next = current + chunk.toString('utf8')
  return next.length <= OUTPUT_LIMIT ? next : next.slice(next.length - OUTPUT_LIMIT)
}

/**
 * Execute one updater child without a shell and bound its time and captured output.
 * @param command - executable path or name.
 * @param args - literal argument vector.
 * @param cwd - fixed source checkout.
 * @param timeoutMs - maximum child lifetime.
 * @returns exit code and bounded output.
 */
const runSourceUpdateCommand: SourceUpdateRunner = async (command, args, cwd, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(command, [...args], {
      cwd,
      env: scrubEnvironment(process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: CommandResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (killTimer !== undefined) clearTimeout(killTimer)
      resolve(result)
    }
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => { child.kill('SIGKILL') }, 5_000)
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => { stdout = appendBounded(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = appendBounded(stderr, chunk) })
    child.once('error', (error) => { finish({ code: -1, stdout, stderr: error.message }) })
    child.once('close', (code) => {
      finish({ code: timedOut ? -1 : code ?? -1, stdout, stderr: timedOut ? `${stderr}\ncommand timed out` : stderr })
    })
  })

/**
 * Remove credentials from dependency and build subprocesses.
 * @param source - inherited desktop environment.
 * @returns environment without secret-bearing variable names.
 */
export function scrubEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([name]) =>
    !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name)))
}

function detailOf(result: CommandResult): string {
  const text = result.stderr.trim() || result.stdout.trim()
  return text.split('\n').at(-1)?.slice(0, 500) || `command exited ${result.code}`
}

function commitOf(result: CommandResult): string | undefined {
  const value = result.stdout.trim()
  return /^[0-9a-f]{40}$/u.test(value) ? value : undefined
}

/** Coordinates official-branch checks, transactional fast-forward updates, and rollback. */
export class SourceUpdater {
  readonly #root: string
  readonly #node: string
  readonly #git: string
  readonly #repository: string
  readonly #branch: string
  readonly #run: SourceUpdateRunner
  readonly #prepare: (sourceRoot: string) => Promise<void>
  #updating = false

  /** @param options - fixed checkout, executables, upstream, and test seams. */
  constructor(options: SourceUpdaterOptions) {
    this.#root = options.sourceRoot
    this.#node = options.nodeCommand
    this.#git = options.gitCommand ?? 'git'
    this.#repository = options.repository ?? OFFICIAL_HARNESS_REPOSITORY
    this.#branch = options.branch ?? OFFICIAL_HARNESS_BRANCH
    this.#run = options.runner ?? runSourceUpdateCommand
    this.#prepare = options.prepare ?? (root => this.#prepareCheckout(root))
  }

  /** Fetch and classify the official stable branch without changing the checked-out branch. */
  async check(): Promise<SourceUpdateStatus> {
    const base = { repository: this.#repository, branch: this.#branch, dirtyFiles: 0 }
    if (!existsSync(join(this.#root, '.git'))) {
      return { ...base, reason: 'not-source-checkout' }
    }
    const top = await this.#run(this.#git, ['rev-parse', '--show-toplevel'], this.#root, GIT_TIMEOUT_MS)
    let exactCheckout = false
    if (top.code === 0 && top.stdout.trim() !== '') {
      try {
        exactCheckout = realpathSync(top.stdout.trim()) === realpathSync(this.#root)
      } catch (_unresolvableCheckoutPath) {
        exactCheckout = false
      }
    }
    if (!exactCheckout) {
      return { ...base, reason: 'not-source-checkout' }
    }
    const currentResult = await this.#run(this.#git, ['rev-parse', 'HEAD^{commit}'], this.#root, GIT_TIMEOUT_MS)
    const currentCommit = commitOf(currentResult)
    if (currentCommit === undefined) {
      return { ...base, reason: 'check-failed', detail: detailOf(currentResult) }
    }
    const dirtyResult = await this.#run(
      this.#git,
      ['status', '--porcelain=v1', '--untracked-files=normal'],
      this.#root,
      GIT_TIMEOUT_MS,
    )
    if (dirtyResult.code !== 0) {
      return { ...base, currentCommit, reason: 'check-failed', detail: detailOf(dirtyResult) }
    }
    const dirtyFiles = dirtyResult.stdout.trim() === '' ? 0 : dirtyResult.stdout.trimEnd().split('\n').length
    const fetch = await this.#run(
      this.#git,
      ['fetch', '--quiet', '--no-tags', this.#repository, this.#branch],
      this.#root,
      GIT_TIMEOUT_MS,
    )
    if (fetch.code !== 0) {
      return { ...base, currentCommit, dirtyFiles, reason: 'check-failed', detail: detailOf(fetch) }
    }
    const latestResult = await this.#run(this.#git, ['rev-parse', 'FETCH_HEAD^{commit}'], this.#root, GIT_TIMEOUT_MS)
    const latestCommit = commitOf(latestResult)
    if (latestCommit === undefined) {
      return { ...base, currentCommit, dirtyFiles, reason: 'check-failed', detail: detailOf(latestResult) }
    }
    if (dirtyFiles > 0) return { ...base, currentCommit, latestCommit, dirtyFiles, reason: 'dirty' }
    if (currentCommit === latestCommit) {
      return { ...base, currentCommit, latestCommit, dirtyFiles, reason: 'current' }
    }
    const upstreamIncluded = await this.#run(
      this.#git,
      ['merge-base', '--is-ancestor', latestCommit, currentCommit],
      this.#root,
      GIT_TIMEOUT_MS,
    )
    if (upstreamIncluded.code === 0) {
      return { ...base, currentCommit, latestCommit, dirtyFiles, reason: 'current' }
    }
    const canFastForward = await this.#run(
      this.#git,
      ['merge-base', '--is-ancestor', currentCommit, latestCommit],
      this.#root,
      GIT_TIMEOUT_MS,
    )
    return {
      ...base,
      currentCommit,
      latestCommit,
      dirtyFiles,
      reason: canFastForward.code === 0 ? 'ready' : 'diverged',
    }
  }

  /**
   * Fast-forward to the confirmed commit, prepare dependencies and build, and roll back on failure.
   * @param expectedCommit - commit shown in the user's confirmation dialog.
   * @returns update result; success requires an application restart.
   */
  async upgrade(expectedCommit: string): Promise<SourceUpdateResult> {
    if (this.#updating) {
      return { ok: false, status: this.#localFailure('check-failed', 'an update is already running') }
    }
    this.#updating = true
    try {
      const status = await this.check()
      if (status.reason !== 'ready' || status.latestCommit !== expectedCommit) {
        return { ok: false, status }
      }
      const previousCommit = status.currentCommit
      if (previousCommit === undefined) return { ok: false, status }
      const merge = await this.#run(
        this.#git,
        ['merge', '--ff-only', expectedCommit],
        this.#root,
        GIT_TIMEOUT_MS,
      )
      if (merge.code !== 0) {
        return { ok: false, status: { ...status, reason: 'check-failed', detail: detailOf(merge) } }
      }
      try {
        await this.#prepare(this.#root)
      } catch (error) {
        const rollback = await this.#run(
          this.#git,
          ['reset', '--hard', previousCommit],
          this.#root,
          GIT_TIMEOUT_MS,
        )
        let rollbackIncomplete = rollback.code !== 0
        if (!rollbackIncomplete) {
          try {
            await this.#prepare(this.#root)
          } catch {
            rollbackIncomplete = true
          }
        }
        return {
          ok: false,
          rollbackIncomplete,
          status: {
            ...status,
            reason: 'check-failed',
            detail: error instanceof Error ? error.message : String(error),
          },
        }
      }
      return { ok: true, previousCommit, currentCommit: expectedCommit, restartRequired: true }
    } finally {
      this.#updating = false
    }
  }

  async #prepareCheckout(root: string): Promise<void> {
    const pnpm = realpathSync(join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'))
    for (const args of [
      [pnpm, 'install', '--frozen-lockfile'],
      [pnpm, 'run', 'build'],
    ]) {
      const result = await this.#run(this.#node, args, root, PREPARE_TIMEOUT_MS)
      if (result.code !== 0) throw new Error(detailOf(result))
    }
  }

  #localFailure(reason: SourceUpdateReason, detail: string): SourceUpdateStatus {
    return {
      repository: this.#repository,
      branch: this.#branch,
      dirtyFiles: 0,
      reason,
      detail,
    }
  }
}
