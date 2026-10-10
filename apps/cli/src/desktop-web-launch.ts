/** Prevent inherited self-restart commands from competing with the Desktop supervisor. */
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'

interface DesktopWebGeneration {
  ownerPid: number
  home: string
  hostPid: number
  generation?: number
}

/**
 * Claim one Desktop-launched Web generation, or suppress an inherited replacement of that Profile.
 * Other profiles and homes retain ordinary CLI behavior; this grants no mutation authority.
 * @param profile - Parsed CLI Profile name.
 * @param home - Resolved data directory for this invocation.
 * @param environment - Process environment inherited by plugin subprocesses.
 * @returns False only for a replacement of the same Desktop-owned Web Profile.
 */
export function claimDesktopWebLaunch(profile: string, home: string, environment: NodeJS.ProcessEnv): boolean {
  const owner = environment.DSH_DESKTOP_WEB_RESTART_OWNER
  if (owner === undefined || profile !== 'web') return true
  const ownerPid = Number(owner)
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) throw new Error('dsh: invalid Desktop restart owner')
  const normalize = (path: string): string => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
  const inherited = environment.DSH_DESKTOP_WEB_GENERATION
  if (inherited !== undefined) {
    const record = JSON.parse(inherited) as Partial<DesktopWebGeneration> | null
    if (record === null || record.ownerPid !== ownerPid || typeof record.home !== 'string'
      || !Number.isSafeInteger(record.hostPid) || (record.hostPid ?? 0) <= 0) {
      throw new Error('dsh: invalid Desktop Web generation')
    }
    return normalize(record.home) !== normalize(home)
  }
  const generation = environment.DSH_DESKTOP_WEB_OWNER_GENERATION
  if (environment.DSH_DESKTOP_WEB_RESTART_STATE !== undefined
    && (generation === undefined || !Number.isSafeInteger(Number(generation)) || Number(generation) <= 0)) {
    throw new Error('dsh: invalid Desktop restart generation')
  }
  environment.DSH_DESKTOP_WEB_GENERATION = JSON.stringify({ ownerPid, home: normalize(home), hostPid: process.pid,
    ...(generation === undefined ? {} : { generation: Number(generation) }) })
  return true
}

/**
 * Keep a delegated replacement alive until its owner has a new normal listener.
 * Helpers interpret early process exit as failed boot and may bind a recovery
 * server. This wait initializes no Profile and carries no authentication data.
 * @param environment - Inherited generation and private Supervisor state path.
 * @param timeoutMs - Bounded wait, shorter than the market helper's boot budget.
 */
export async function waitForDesktopWebRestart(environment: NodeJS.ProcessEnv, timeoutMs = 45_000): Promise<void> {
  const path = environment.DSH_DESKTOP_WEB_RESTART_STATE
  if (path === undefined) return
  const inherited = JSON.parse(environment.DSH_DESKTOP_WEB_GENERATION ?? 'null') as DesktopWebGeneration | null
  const previousGeneration = inherited?.generation
  if (inherited === null || typeof previousGeneration !== 'number' || !Number.isSafeInteger(previousGeneration) || previousGeneration <= 0) {
    throw new Error('dsh: invalid Desktop restart generation')
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { process.kill(inherited.ownerPid, 0) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
      throw error
    }
    let source: string | undefined
    try { source = await readFile(path, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (source !== undefined) {
      const state = JSON.parse(source) as { ownerPid?: number; generation?: number; phase?: string } | null
      const generation = state?.generation
      if (state === null || state.ownerPid !== inherited.ownerPid || typeof generation !== 'number' || !Number.isSafeInteger(generation)
        || generation <= 0 || !['starting', 'ready', 'failed', 'stopped'].includes(state.phase ?? '')) {
        throw new Error('dsh: invalid Desktop restart state')
      }
      if (state.phase === 'failed' || state.phase === 'stopped') return
      if (state.phase === 'ready' && generation > previousGeneration) return
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('dsh: Desktop restart readiness timed out')
}
