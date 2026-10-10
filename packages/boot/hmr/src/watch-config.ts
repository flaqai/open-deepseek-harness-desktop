/** Exact-path watching for live profile patch files outside Cordis module roots. */
import { dirname, relative, resolve } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import type { ChokidarOptions } from 'chokidar'
import type { Context } from '@deepseek-ai/cordis'

const registrations = new WeakMap<Context, Set<string>>()

async function findWatchRoot(filename: string): Promise<{ filename: string; root: string; depth: number }> {
  let root = dirname(filename)
  let depth = 0
  while (true) {
    try {
      if (!(await stat(root)).isDirectory()) throw new Error(`config watch parent is not a directory: ${root}`)
      const canonicalRoot = await realpath(root)
      return { filename: resolve(canonicalRoot, relative(root, filename)), root: canonicalRoot, depth }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(root)
      if (parent === root) throw error
      root = parent
      depth += 1
    }
  }
}

/**
 * Watch one patch path, including missing parents, and serialize refresh callbacks.
 * @param ctx Context that owns watcher disposal and receives refresh failures.
 * @param filename Absolute patch-file path.
 * @param options Deployment watcher options; `interval` sets the exact-path stat-poll cadence.
 * @param refresh Callback for additions, changes, and removals.
 * @param inTransaction Whether disposal is running inside the refresh being removed.
 * @returns A disposer that closes the watcher and drains its current refresh.
 * @throws When path resolution, watcher startup, or effect registration fails.
 */
export async function watchConfig(
  ctx: Context, filename: string, options: ChokidarOptions, refresh: () => Promise<void> | void,
  inTransaction: () => boolean = () => false,
): Promise<() => Promise<void>> {
  const target = await findWatchRoot(filename)
  const paths = registrations.get(ctx) ?? new Set<string>()
  registrations.set(ctx, paths)
  if (paths.has(target.filename)) throw new Error(`config path already registered: ${filename}`)
  const interval = options.interval ?? 500
  const readStamp = async (): Promise<string | undefined> => {
    try {
      const value = await stat(target.filename)
      return `${value.dev}:${value.ino}:${value.size}:${value.mtimeMs}:${value.ctimeMs}`
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
  // Patch layers are two exact, low-frequency files. Stat-polling those paths
  // avoids recursively enumerating a large pnpm Profile and remains reliable
  // when the file or an intermediate parent does not exist yet. It also avoids
  // macOS's low per-app kqueue descriptor ceiling in packaged launches.
  let previous = await readStamp()
  const state = { dirty: false, disposed: false }
  let running: Promise<void> | undefined
  const onChange = () => {
    if (state.disposed) return
    state.dirty = true
    if (running) return
    running = (async () => {
      while (state.dirty && !state.disposed) {
        state.dirty = false
        try {
          await refresh()
        } catch (reason) {
          const error = reason instanceof Error ? reason : new Error(String(reason), { cause: reason })
          ctx.logger.warn('config reload at %C failed', filename)
          ctx.logger.warn(error)
        }
      }
    })().finally(() => { running = undefined })
  }
  let polling: Promise<void> | undefined
  const timer = setInterval(() => {
    if (state.disposed || polling !== undefined) return
    polling = (async () => {
      try {
        const current = await readStamp()
        if (state.disposed) return
        if (current === previous) return
        previous = current
        onChange()
      } catch (error) {
        if (!state.disposed) ctx.logger.warn(error)
      }
    })().finally(() => { polling = undefined })
  }, interval)
  timer.unref()
  paths.add(target.filename)
  const dispose = async () => {
    state.disposed = true
    state.dirty = false
    clearInterval(timer)
    paths.delete(target.filename)
    await polling
    if (!inTransaction()) await running
  }
  try {
    return ctx.effect(() => dispose, 'hmr.watchConfig()')
  } catch (error) {
    await dispose()
    throw error
  }
}
