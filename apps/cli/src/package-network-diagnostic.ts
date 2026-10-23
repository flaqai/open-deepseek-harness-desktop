/** Bounded network hints derived from error codes, never from credential-bearing output. */

const NETWORK_FAILURES = [
  [/ERR_PNPM_FETCH_407|proxy authentication/iu, 'proxy-auth', 'Check proxy authentication.'],
  [/CERT_HAS_EXPIRED|SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT|ERR_TLS_CERT_ALTNAME_INVALID/iu, 'tls', 'Check the certificate chain and configured CA; do not disable TLS verification.'],
  [/ERR_PNPM_FETCH_40[13]|\bE401\b|\bE403\b|Authentication failed/iu, 'authentication', 'Check registry or Git credentials and repository access.'],
  [/\bENOTFOUND\b|\bEAI_AGAIN\b/iu, 'dns', 'Check DNS resolution for the registry, archive host, or Git host.'],
  [/UND_ERR_CONNECT_TIMEOUT|\bETIMEDOUT\b|Connection timed out/iu, 'connect-timeout', 'Check the destination and proxy reachability; a timeout alone does not identify an undici defect.'],
  [/\bECONNREFUSED\b|\bECONNRESET\b|\bUND_ERR_SOCKET\b/iu, 'connection', 'Check whether the destination or configured proxy is reachable.'],
  [/ERR_PNPM_META_FETCH_FAIL/iu, 'metadata-fetch', 'Check registry access and pnpm global proxy settings. If Desktop keeps existing npm configuration, select Direct connection or a working Custom proxy.'],
] as const

/**
 * Explain recognized pnpm network failures without copying URLs, paths, or environment values.
 * @param diagnostic - Original pnpm output used only for classification.
 * @param elapsedMs - Elapsed time for this pnpm invocation.
 * @param environment - Failing operation's environment, used to identify explicit proxy configuration.
 * @returns A bounded hint, or undefined for unrelated errors. This does not prove the effective route.
 */
export function packageNetworkDiagnostic(
  diagnostic: string, elapsedMs: number, environment: NodeJS.ProcessEnv,
): string | undefined {
  const failure = NETWORK_FAILURES.find(([pattern]) => pattern.test(diagnostic))
  if (failure === undefined) return undefined
  const explicit = Object.entries(environment).some(([key, value]) =>
    /^(?:(?:https?|all)_proxy|(?:pnpm|npm)_config_(?:https?_proxy|proxy))$/iu.test(key) && Boolean(value?.trim()),
  )
  const source = explicit ? 'explicit proxy environment present' : 'no explicit proxy environment; pnpm/Git configuration may still apply'
  return `dsh: pnpm network ${failure[1]} after ${String(Math.max(0, Math.round(elapsedMs)))} ms; ${source}; effective route unverified. ${failure[2]}`
}
