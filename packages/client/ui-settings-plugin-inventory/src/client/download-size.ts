/** Presentation of audited, uncached package download estimates across supported targets. */
import { downloadSizeData } from './download-size-data.ts'

/** Known byte range; incomplete measurements remain lower bounds. */
export interface DownloadSizeEstimate {
  readonly minimum: number
  readonly maximum: number
  readonly additionalUnknown: boolean
}

/**
 * Average complete option measurements without dropping unknown choices or targets.
 * @param choices Actual installation recipe identifiers.
 * @param preinstalled Recipe identities supplied locally, counted as zero additional download.
 * @returns Across-target byte range, or undefined when any measurement is unavailable.
 */
export function downloadSizeEstimate(choices: readonly string[], preinstalled: readonly string[] = []): DownloadSizeEstimate | undefined {
  if (choices.length === 0) return undefined
  const measurements = choices.map<{
    targets: Record<string, { downloadBytes: number | null; additionalUnknown: boolean }>
  } | undefined>(choice => preinstalled.includes(choice)
    ? { targets: { local: { downloadBytes: 0, additionalUnknown: false } } } : downloadSizeData.choices[choice])
  if (measurements.some(choice => choice === undefined)) return undefined
  let minimum = 0
  let maximum = 0
  let additionalUnknown = false
  for (const choice of measurements) {
    if (choice === undefined) return undefined
    const targets = Object.values(choice.targets)
    if (targets.length === 0 || targets.some(target => target.downloadBytes === null)) return undefined
    const sizes = targets.map(target => target.downloadBytes as number)
    minimum += Math.min(...sizes)
    maximum += Math.max(...sizes)
    additionalUnknown ||= targets.some(target => target.additionalUnknown)
  }
  return { minimum: minimum / choices.length, maximum: maximum / choices.length, additionalUnknown }
}

/**
 * Format decimal download megabytes, retaining a lower-bound marker for extra downloads.
 * @param estimate Audited across-target measurements.
 * @returns Compact numeric download copy, independent of locale-owned labels.
 */
export function formatDownloadSize(estimate: DownloadSizeEstimate): string {
  const mb = (bytes: number) => bytes < 100_000 ? '<0.1' : (bytes / 1_000_000).toFixed(1)
  if (estimate.additionalUnknown) return `≥ ${(Math.floor(estimate.minimum / 100_000) / 10).toFixed(1)} MB`
  const low = mb(estimate.minimum)
  const high = mb(estimate.maximum)
  return `${low === high ? low : `${low}–${high}`} MB`
}
