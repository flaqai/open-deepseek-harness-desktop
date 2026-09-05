/** Durable, redacted incidents produced by bounded desktop startup operations. */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const STARTUP_DIAGNOSTIC_SCHEMA = 'dsh/desktop-startup-diagnostic/v1' as const

export type StartupDiagnosticCode =
  | 'runtime.bundled-plugin-failed'
  | 'runtime.bundled-plugin-timeout'
  | 'runtime.profile-check-timeout'
  | 'runtime.profile-mutation-lock-busy'
  | 'runtime.profile-repair-failed'
  | 'runtime.profile-repair-timeout'
  | 'runtime.startup-rollback-failed'

const STARTUP_DIAGNOSTIC_CODES = new Set<StartupDiagnosticCode>([
  'runtime.bundled-plugin-failed',
  'runtime.bundled-plugin-timeout',
  'runtime.profile-check-timeout',
  'runtime.profile-mutation-lock-busy',
  'runtime.profile-repair-failed',
  'runtime.profile-repair-timeout',
  'runtime.startup-rollback-failed',
])

const STARTUP_DIAGNOSTIC_ACTIONS = new Set<StartupDiagnosticIncident['actions'][number]>([
  'diagnostics', 'open-log', 'retry-plugin', 'switch-profile', 'snapshot-restore',
])

export interface StartupDiagnosticIncident {
  readonly incidentId: string
  readonly code: StartupDiagnosticCode
  readonly operation: string
  readonly packageName?: string
  readonly createdAt: string
  readonly actions: readonly ('diagnostics' | 'open-log' | 'retry-plugin' | 'switch-profile' | 'snapshot-restore')[]
}

interface StartupDiagnosticDocument {
  readonly schema: typeof STARTUP_DIAGNOSTIC_SCHEMA
  readonly incidents: readonly StartupDiagnosticIncident[]
}

function pathFor(home: string): string {
  return join(home, 'diagnostics', 'desktop-startup.v1.json')
}

function validIncident(value: unknown): value is StartupDiagnosticIncident {
  if (value === null || typeof value !== 'object') return false
  const incident = value as Partial<StartupDiagnosticIncident>
  return typeof incident.incidentId === 'string' && incident.incidentId.length <= 80
    && typeof incident.code === 'string' && STARTUP_DIAGNOSTIC_CODES.has(incident.code)
    && typeof incident.operation === 'string' && incident.operation.length <= 160
    && typeof incident.createdAt === 'string' && Number.isFinite(Date.parse(incident.createdAt))
    && Array.isArray(incident.actions)
    && incident.actions.every(action => typeof action === 'string'
      && STARTUP_DIAGNOSTIC_ACTIONS.has(action as StartupDiagnosticIncident['actions'][number]))
    && (incident.packageName === undefined
      || (typeof incident.packageName === 'string' && incident.packageName.length <= 214))
}

/** Read only valid bounded startup incidents; damaged documents fail closed as empty. */
export async function readStartupDiagnostics(home: string): Promise<readonly StartupDiagnosticIncident[]> {
  try {
    const value = JSON.parse(await readFile(pathFor(home), 'utf8')) as Partial<StartupDiagnosticDocument>
    if (value.schema !== STARTUP_DIAGNOSTIC_SCHEMA || !Array.isArray(value.incidents)) return []
    return value.incidents.filter(validIncident).slice(-50)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    return []
  }
}

/** Append one redacted incident, replacing an identical unresolved entry. */
export async function recordStartupDiagnostic(
  home: string,
  incident: Omit<StartupDiagnosticIncident, 'createdAt' | 'incidentId'>,
): Promise<StartupDiagnosticIncident> {
  const current = await readStartupDiagnostics(home)
  const record: StartupDiagnosticIncident = {
    ...incident,
    incidentId: randomUUID(),
    createdAt: new Date().toISOString(),
  }
  const retained = current.filter(candidate => !(
    candidate.code === record.code
    && candidate.operation === record.operation
    && candidate.packageName === record.packageName
  ))
  const document: StartupDiagnosticDocument = {
    schema: STARTUP_DIAGNOSTIC_SCHEMA,
    incidents: [...retained, record].slice(-50),
  }
  const path = pathFor(home)
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(temporary, `${JSON.stringify(document, undefined, 2)}\n`, { flag: 'wx', mode: 0o600 })
  await rename(temporary, path)
  return record
}

/** Clear incidents after a fully healthy startup. */
export async function clearStartupDiagnostics(home: string): Promise<void> {
  const path = pathFor(home)
  const document: StartupDiagnosticDocument = { schema: STARTUP_DIAGNOSTIC_SCHEMA, incidents: [] }
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(temporary, `${JSON.stringify(document, undefined, 2)}\n`, { flag: 'wx', mode: 0o600 })
  await rename(temporary, path)
}
