/** Bind the experimental foreground provider to this Desktop Host generation. */

import type { Context } from '@deepseek-ai/cordis'
import { createOrbComputerUseProvider } from '@deepseek-ai/dsh-computer-use-orb-native'
import { createDesktopOrbHttpBackend, type DesktopOrbEndpoint } from './orb-computer-use-client.ts'

import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-computer-use'
import type {} from '@deepseek-ai/dsh-web-app'

/** Open one native transport using the provider's exclusive reservation. */
export type OrbBackendOpener = typeof createDesktopOrbHttpBackend

/**
 * Mount GUI tools only for a Desktop launch with a Host-owned Orb caller.
 * An exact live Agent and the durable caller record are both required for execution.
 * @param ctx - settled Desktop Host context.
 * @param endpoint - generation-scoped native endpoint consumed from launch environment.
 * @param open - native HTTP client, replaceable in Host tests.
 * @returns provider activation after native transport reservation.
 */
export async function mountDesktopOrbComputerUse(
  ctx: Context,
  endpoint: DesktopOrbEndpoint,
  open: OrbBackendOpener = createDesktopOrbHttpBackend,
): Promise<void> {
  if (ctx.get('computerUse')?.providerName !== undefined) return
  const owner = ctx.get('desktopOrbCaller')
  if (owner === undefined) throw new Error('orb computer use: Host-owned caller identity is unavailable')
  await ctx.plugin(createOrbComputerUseProvider({
    open: acquireExclusive => open(endpoint, acquireExclusive),
    async authorize(agent, signal) {
      signal.throwIfAborted()
      if (ctx.get('agents')?.get(agent.id) !== agent || agent.id !== agent.session.id) return false
      const allowed = await owner.ownsCaller(agent.session.id)
      signal.throwIfAborted()
      return allowed
    },
  }))
}
