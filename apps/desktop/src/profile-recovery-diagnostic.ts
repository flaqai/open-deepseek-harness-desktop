/** Bounded recovery evidence; an absent per-plugin error never establishes activation. */
export interface ProfileRecoveryDiagnostic {
  readonly category: 'missing-local-archive' | 'invalid-transaction-journal' | 'permission' | 'busy' | 'dependency-operation-failed' | 'unknown'
  readonly operation?: string
  readonly blockedPackage?: string
  readonly missingArchive?: string
  readonly rootPackage?: string
  readonly causes: readonly {
    readonly name: string
    readonly message: string
    readonly code?: string
    readonly operationId?: string
    readonly kind?: string
    readonly phase?: string
  }[]
}

function redact(text: string, home: string): string {
  return (home === '' ? text : text.replaceAll(home, '<dsh-home>')).slice(0, 32_768)
    .replace(/\b[A-Z]:[\\/][^"'\r\n]*/giu, '<local-path>')
    .replace(/\/(?:Users|home)\/[^/\s"']+/gu, '<user-home>')
    .replace(/https?:\/\/[^\s<>"']+/giu, (source) => {
      try {
        const url = new URL(source)
        url.username = ''; url.password = ''; url.search = ''; url.hash = ''
        return url.href
      } catch { return '<redacted-url>' }
    })
    .replace(/\b(?:authorization\s*[:=]\s*)?Bearer\s+[^\s,;]+/giu, 'Bearer <redacted>')
    .replace(/\b(api[ _-]?key|token|password|secret|authorization|cookie)(["\s:=]+)([^\s,;]+)/giu, '$1$2<redacted>')
    .slice(0, 1_200)
}

/**
 * Preserve bounded cause-chain evidence without retaining credentials or arbitrary object fields.
 * @param error - Original transaction or dependency failure.
 * @param context - Local home to redact and the known operation, when available.
 * @returns Redacted evidence and a conservative failure category; unknown causes remain unknown.
 */
export function summarizeProfileRecoveryFailure(
  error: unknown, context: { readonly home: string; readonly operation?: string },
): ProfileRecoveryDiagnostic {
  const causes: Array<ProfileRecoveryDiagnostic['causes'][number]> = []
  const seen = new Set<unknown>()
  const pending: unknown[] = [error]
  let missingArchive: string | undefined
  let rootPackage: string | undefined
  let category: ProfileRecoveryDiagnostic['category'] = 'unknown'
  while (causes.length < 5 && pending.length > 0) {
    const current = pending.shift()
    if (current === undefined || seen.has(current)) continue
    seen.add(current)
    const item = current instanceof Error ? current : new Error(typeof current === 'string' ? current : 'Unknown recovery failure')
    const fields = item as Error & {
      code?: unknown
      operationId?: unknown
      kind?: unknown
      phase?: unknown
      missingArchive?: unknown
      packageName?: unknown
    }
    const message = item.message
    if (fields.code === 'DESKTOP_MISSING_LOCAL_ARCHIVE' || fields.code === 'desktop.plugin-archive-missing') {
      category = 'missing-local-archive'
      const archive = typeof fields.missingArchive === 'string' ? fields.missingArchive.replaceAll('\\', '/').split('/').at(-1) : undefined
      if (archive !== undefined && /^[^/\\\r\n]{1,240}\.tgz$/u.test(archive)) missingArchive = archive
      if (typeof fields.packageName === 'string' && fields.packageName.length <= 214
        && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/iu.test(fields.packageName)) rootPackage = fields.packageName
    } else if (message.includes('ERR_PNPM_TARBALL_READ_LOCAL_TARBALL') && /\bENOENT\b/u.test(message)) {
      category = 'missing-local-archive'
      const archive = /[\\/]([^\\/"'\r\n]+\.tgz)(?=["'\s:]|$)/iu.exec(message)?.[1]
      if (archive !== undefined && archive.length <= 240) missingArchive = archive
    } else if (category === 'unknown') {
      if (fields.code === 'EACCES' || fields.code === 'EPERM') category = 'permission'
      else if (fields.code === 'EBUSY') category = 'busy'
      else if (message.startsWith('desktop: invalid plugin transaction journal')
        || message.startsWith('desktop: unsafe plugin transaction journal')) category = 'invalid-transaction-journal'
      else if (typeof fields.kind === 'string') category = 'dependency-operation-failed'
    }
    const clean = (value: unknown): string | undefined => typeof value === 'string' ? redact(value, context.home).slice(0, 200) : undefined
    const code = clean(fields.code)
    const operationId = clean(fields.operationId)
    const kind = clean(fields.kind)
    const phase = clean(fields.phase)
    causes.push({ name: clean(item.name) ?? 'Error', message: redact(message, context.home),
      ...(code === undefined ? {} : { code }),
      ...(operationId === undefined ? {} : { operationId }),
      ...(kind === undefined ? {} : { kind }), ...(phase === undefined ? {} : { phase }) })
    if (item.cause !== undefined) pending.push(item.cause)
    if (item instanceof AggregateError) {
      const errors: readonly unknown[] = item.errors
      pending.push(...errors.slice(0, 5))
    }
  }
  const operation = context.operation === undefined ? undefined : redact(context.operation, context.home).slice(0, 200)
  const sourceOperation = context.operation ?? causes.find(cause => cause.kind !== undefined)?.kind ?? ''
  const blockedPackage = /^(?:bundled-plugin(?:-install)?|imported-plugin):((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)$/iu.exec(sourceOperation)?.[1]
  return { category, causes, ...(rootPackage === undefined ? {} : { rootPackage }), ...(operation === undefined ? {} : { operation }),
    ...(blockedPackage === undefined ? {} : { blockedPackage }), ...(missingArchive === undefined ? {} : { missingArchive }) }
}
