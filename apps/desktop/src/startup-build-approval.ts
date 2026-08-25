/** Startup recovery metadata for pnpm build scripts blocked by policy. */

/** One safely isolated startup repair that can be restored after explicit approval. */
export interface StartupBuildApproval {
  readonly packageBuildKey: string
  readonly quarantineIds: readonly string[]
}

interface RepairReportShape {
  readonly status?: unknown
  readonly diagnostic?: unknown
  readonly quarantined?: unknown
}

const RETAINED_BUILD_KEY = /^dsh: pnpm allowBuilds key (".*")$/mu

function parseBuildKey(diagnostic: string): string | undefined {
  const retained = RETAINED_BUILD_KEY.exec(diagnostic)
  if (retained?.[1] === undefined) return undefined
  try {
    const value: unknown = JSON.parse(retained[1])
    return typeof value === 'string' && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Parse a doctor repair report without trusting free-form pnpm output as an
 * approval command. The CLI validates the retained key again before writing it.
 * @param output - Complete stdout/stderr from `plugin doctor --repair`.
 * @returns Approval metadata only when repair already isolated at least one plugin.
 */
export function parseStartupBuildApproval(output: string): StartupBuildApproval | undefined {
  let report: RepairReportShape
  try {
    report = JSON.parse(output.trim()) as RepairReportShape
  } catch {
    return undefined
  }
  if (report.status !== 'quarantined' || typeof report.diagnostic !== 'string') return undefined
  const packageBuildKey = parseBuildKey(report.diagnostic)
  if (packageBuildKey === undefined || !Array.isArray(report.quarantined)) return undefined
  const quarantineIds = report.quarantined.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return []
    const value = (entry as { quarantineId?: unknown }).quarantineId
    return typeof value === 'string' && value.length > 0 ? [value] : []
  })
  return quarantineIds.length === 0 ? undefined : { packageBuildKey, quarantineIds }
}
