/** Trusted server-local NAS administrator recovery; no network transport is opened. */
import { Context } from '@deepseek-ai/cordis'
import { createNasAdministratorRecovery } from '@deepseek-ai/dsh-client-connection'
import { LocalCredentialProvider, CREDENTIALS_FILENAME } from '@deepseek-ai/dsh-credentials-local'
import { join, resolve } from 'node:path'

/** Explicit local store selected by the server operator. */
export interface NasAdministratorRecoveryOptions {
  /** NAS server Harness home; not a remote client cache directory. */
  home: string
  /** Custom local credentials document, matching the server's provider configuration. */
  credentialsFile?: string
}

/** Issue a temporary administrator invitation through the server's local credentials provider.
 * @param options - server-local home and optional explicit credentials document.
 * @returns the private pairing code, expiry, and document used for recovery.
 * @throws when the credentials document cannot be securely read or atomically updated.
 */
export async function issueNasAdministratorRecovery(options: NasAdministratorRecoveryOptions): Promise<{
  code: string
  expiresAt: string
  credentialsFile: string
}> {
  const credentialsFile = resolve(options.credentialsFile ?? join(options.home, CREDENTIALS_FILENAME))
  const ctx = new Context()
  try {
    await ctx.plugin(LocalCredentialProvider, { path: credentialsFile, watch: false })
    return { ...await createNasAdministratorRecovery(ctx.credentials), credentialsFile }
  } finally {
    await ctx.fiber.dispose()
  }
}
