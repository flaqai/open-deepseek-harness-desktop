/** Guarded bridge from the framework-free browser boot kernel to Host profile quarantine. */

/** Closed browser evidence accepted by the Host recovery Remote. */
export interface ClientLoadFailure {
  readonly packageName: string
  readonly entryId: string
  readonly requestedModule: string
  readonly code: 'client-module-unavailable'
}

/** Minimal result returned before the desktop Host restarts. */
export interface ClientLoadRecoveryResult {
  readonly packageName: string
  readonly status: 'quarantined' | 'failed'
  readonly restartScheduled: boolean
}

type RecoveryFetch = (input: URL, init: RequestInit) => Promise<Response>

const LOADER_IMPORT_FAILURE = /failed to import loader entry\s+([^\s(:]+)(?:\s+\(([^)\r\n]+)\))?/iu
const CLIENT_MODULE_UNAVAILABLE = new RegExp(
  String.raw`client-modules:\s*require\((['"])([^'"\r\n]+)\1\).*?`
  + String.raw`(?:missed the module table|not a materialized module|no registered package factory)`,
  'isu',
)
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/iu
const MODULE_REQUEST = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/[a-z0-9._~/-]+)?$/iu
const ENTRY_ID = /^[A-Za-z0-9._~-]{1,128}$/u

/** Walk one native Error cause chain without trusting arbitrary nested objects. */
function errorMessages(reason: unknown): string[] {
  const messages: string[] = []
  const seen = new Set<unknown>()
  let value: unknown = reason
  while (value instanceof Error && !seen.has(value) && messages.length < 8) {
    seen.add(value)
    messages.push(value.message)
    value = value.cause
  }
  if (messages.length === 0) messages.push(String(reason))
  return messages
}

/**
 * Parse only the deterministic client-module invariant paired with its Loader owner.
 * Generic plugin exceptions deliberately return undefined and remain visible to the user.
 * @param reason - Loader failure or Error cause chain reported during client boot.
 * @returns Closed recovery evidence, or undefined when the failure cannot be safely attributed.
 */
export function clientLoadFailure(reason: unknown): ClientLoadFailure | undefined {
  const messages = errorMessages(reason)
  let owner: RegExpExecArray | null = null
  let missing: RegExpExecArray | null = null
  for (const message of messages) {
    owner ??= LOADER_IMPORT_FAILURE.exec(message)
    missing ??= CLIENT_MODULE_UNAVAILABLE.exec(message)
  }
  const entryId = owner?.[1]
  const packageName = owner?.[2]
  const requestedModule = missing?.[2]
  if (entryId === undefined || packageName === undefined || requestedModule === undefined
    || !ENTRY_ID.test(entryId) || !PACKAGE_NAME.test(packageName) || !MODULE_REQUEST.test(requestedModule)) {
    return undefined
  }
  return { packageName, entryId, requestedModule, code: 'client-module-unavailable' }
}

/**
 * Call the authenticated Host Remote without depending on any client plugin having loaded.
 * @param request - Validated client-load failure evidence to quarantine.
 * @param send - Fetch-compatible transport, injectable for deterministic tests.
 * @returns Host recovery status received before the desktop process restarts.
 */
export async function recoverClientLoadFailure(
  request: ClientLoadFailure,
  send: RecoveryFetch = (input, init) => globalThis.fetch(input, init),
): Promise<ClientLoadRecoveryResult> {
  const rpcId = globalThis.crypto.randomUUID()
  const origin = globalThis.location.origin
  if (origin === 'null') throw new Error('web boot recovery requires a served application origin')
  const response = await send(new URL('api/pluginInventory/recoverClientLoadFailure', document.baseURI), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method: 'pluginInventory/recoverClientLoadFailure',
      payload: { args: { request } },
    }),
  })
  if (!response.ok) throw new Error(`web boot recovery transport failed with HTTP ${String(response.status)}`)
  const value: unknown = await response.json()
  if (!isRecord(value) || value.type !== 'server-response' || value.rpcId !== rpcId
    || !isRecord(value.result)) {
    throw new TypeError('web boot recovery received an invalid RPC envelope')
  }
  if (value.result.ok !== true || !isRecoveryResult(value.result.value)) {
    throw new Error('web boot recovery was rejected by the Host')
  }
  return value.result.value
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRecoveryResult(value: unknown): value is ClientLoadRecoveryResult {
  return isRecord(value)
    && typeof value.packageName === 'string'
    && (value.status === 'quarantined' || value.status === 'failed')
    && typeof value.restartScheduled === 'boolean'
}
