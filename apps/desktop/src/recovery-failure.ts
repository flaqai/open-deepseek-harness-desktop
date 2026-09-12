/** Project the durable Profile diagnostic into the narrow recovery-page URL contract. */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_REPORT_BYTES = 1024 * 1024
const MAX_EVIDENCE_LENGTH = 1_200

/** Client-safe startup failure fields understood by the installation-owned loading page. */
export interface RecoveryFailureSummary {
  readonly diagnosticCode: string
  readonly nativeCode?: string
  readonly packageName?: string
  readonly entryId?: string
  readonly moduleName?: string
  readonly evidence?: string
}

interface CandidateIssue {
  readonly code?: unknown
  readonly nativeCode?: unknown
  readonly severity?: unknown
  readonly evidence?: unknown
  readonly attribution?: {
    readonly rootPackage?: unknown
    readonly entryId?: unknown
    readonly moduleName?: unknown
    readonly missingModule?: unknown
  }
}

const severityRank = (severity: unknown): number => (
  severity === 'security' ? 4 : severity === 'blocked' ? 3 : severity === 'warning' ? 2 : 1
)

function boundedString(value: unknown, maximum = 240): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/[\r\n\t]+/gu, ' ').trim()
  return normalized.length === 0 ? undefined : normalized.slice(0, maximum)
}

/**
 * Read the highest-urgency current Profile issue without exposing the report or filesystem path.
 * @param dshHome Active Desktop Harness home.
 * @returns A bounded recovery-page summary, or undefined when no valid current issue exists.
 */
export function readRecoveryFailureSummary(dshHome: string): RecoveryFailureSummary | undefined {
  const path = join(dshHome, 'profile-health', 'web.diagnostics.json')
  if (!existsSync(path)) return undefined
  try {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_REPORT_BYTES) return undefined
    const value = JSON.parse(readFileSync(path, 'utf8')) as {
      readonly schema?: unknown
      readonly profile?: unknown
      readonly issues?: unknown
    }
    if (value.schema !== 'dsh/profile-diagnostic/v2' || value.profile !== 'web' || !Array.isArray(value.issues)) {
      return { diagnosticCode: 'desktop.diagnostic-report-invalid' }
    }
    const issues = (value.issues as CandidateIssue[])
      .filter(issue => typeof issue.code === 'string')
      .sort((left, right) => severityRank(right.severity) - severityRank(left.severity))
    const issue = issues[0]
    if (issue === undefined || typeof issue.code !== 'string') return undefined
    const attribution = issue.attribution
    const evidence = Array.isArray(issue.evidence)
      ? boundedString(issue.evidence.find(item => typeof item === 'string'), MAX_EVIDENCE_LENGTH)
      : undefined
    const nativeCode = boundedString(issue.nativeCode)
    const packageName = boundedString(attribution?.rootPackage)
    const entryId = boundedString(attribution?.entryId)
    const moduleName = boundedString(attribution?.moduleName ?? attribution?.missingModule)
    return {
      diagnosticCode: issue.code,
      ...(nativeCode === undefined ? {} : { nativeCode }),
      ...(packageName === undefined ? {} : { packageName }),
      ...(entryId === undefined ? {} : { entryId }),
      ...(moduleName === undefined ? {} : { moduleName }),
      ...(evidence === undefined ? {} : { evidence }),
    }
  } catch {
    return { diagnosticCode: 'desktop.diagnostic-report-invalid' }
  }
}
