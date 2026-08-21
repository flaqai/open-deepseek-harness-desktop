import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-brand-community-desktop'
export const name = 'client-ui-brand-community-desktop-invariant'
export const inject = ['invariants']
/** No runtime invariant: this package only contributes stateless brand slot renderers. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
