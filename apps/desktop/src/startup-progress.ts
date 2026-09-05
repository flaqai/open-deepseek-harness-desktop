/** Truthful startup milestones shared by the Electron main process and loading page. */

import type { BundledPluginSeedStage } from './bundled-plugin-seed.ts'

export type DesktopStartupStage =
  | 'preparing-desktop'
  | 'preparing-runtime'
  | 'checking-profile'
  | 'verifying-plugin'
  | 'extracting-plugin'
  | 'configuring-plugin'
  | 'starting-harness'
  | 'restarting-harness'
  | 'ready'

/** Point-in-time progress backed by a completed or active startup operation. */
export interface DesktopStartupProgress {
  readonly stage: DesktopStartupStage
  readonly progress: number
  readonly detail?: string
  readonly startedAt?: number
  readonly deadlineAt?: number
  readonly state?: 'degraded' | 'running'
}

const pluginStages: Record<BundledPluginSeedStage, DesktopStartupStage> = {
  verifying: 'verifying-plugin',
  extracting: 'extracting-plugin',
  configuring: 'configuring-plugin',
}

const startupStages: readonly DesktopStartupStage[] = [
  'preparing-desktop',
  'preparing-runtime',
  'checking-profile',
  'verifying-plugin',
  'extracting-plugin',
  'configuring-plugin',
  'starting-harness',
  'restarting-harness',
  'ready',
]

/**
 * Clamp a progress value to the determinate progress-bar range.
 * @param value - Candidate progress supplied through internal lifecycle code or IPC.
 * @returns An integer from zero through one hundred.
 */
export function clampStartupProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

/**
 * Map one real bundled-plugin milestone into the startup bar's plugin interval.
 * @param packageName - Manifest package currently being seeded.
 * @param index - Zero-based startup-plugin position.
 * @param total - Number of startup plugins in the manifest.
 * @param stage - Real seed operation reported by the installer.
 * @param progress - Progress within that plugin's seed operation.
 * @returns A startup snapshot in the reserved 36-to-84 percent interval.
 */
export function mapBundledPluginProgress(
  packageName: string,
  index: number,
  total: number,
  stage: BundledPluginSeedStage,
  progress: number,
): DesktopStartupProgress {
  const safeTotal = Math.max(1, Math.floor(total))
  const safeIndex = Math.min(safeTotal - 1, Math.max(0, Math.floor(index)))
  const completed = safeIndex + clampStartupProgress(progress) / 100
  return {
    stage: pluginStages[stage],
    progress: clampStartupProgress(36 + completed / safeTotal * 48),
    detail: packageName,
  }
}

/**
 * Validate an internal IPC payload before it changes the loading document.
 * @param value - Untrusted value received by the sandboxed preload.
 * @returns A normalized snapshot, or `undefined` for malformed input.
 */
export function parseDesktopStartupProgress(value: unknown): DesktopStartupProgress | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as {
    stage?: unknown
    progress?: unknown
    detail?: unknown
    startedAt?: unknown
    deadlineAt?: unknown
    state?: unknown
  }
  if (typeof candidate.stage !== 'string' || !startupStages.includes(candidate.stage as DesktopStartupStage)) {
    return undefined
  }
  if (typeof candidate.progress !== 'number' || !Number.isFinite(candidate.progress)) return undefined
  if (candidate.detail !== undefined && typeof candidate.detail !== 'string') return undefined
  if (candidate.startedAt !== undefined
    && (typeof candidate.startedAt !== 'number' || !Number.isFinite(candidate.startedAt))) return undefined
  if (candidate.deadlineAt !== undefined
    && (typeof candidate.deadlineAt !== 'number' || !Number.isFinite(candidate.deadlineAt))) return undefined
  if (candidate.state !== undefined && candidate.state !== 'running' && candidate.state !== 'degraded') return undefined
  return {
    stage: candidate.stage as DesktopStartupStage,
    progress: clampStartupProgress(candidate.progress),
    ...(candidate.detail === undefined ? {} : { detail: candidate.detail.slice(0, 160) }),
    ...(candidate.startedAt === undefined ? {} : { startedAt: candidate.startedAt }),
    ...(candidate.deadlineAt === undefined ? {} : { deadlineAt: candidate.deadlineAt }),
    ...(candidate.state === undefined ? {} : { state: candidate.state }),
  }
}
