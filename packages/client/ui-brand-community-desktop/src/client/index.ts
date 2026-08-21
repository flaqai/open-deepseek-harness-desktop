import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { CommunityBrandMark, CommunityBrandName } from './Brand.tsx'

export const inject = ['slots']

/** Fill the generic brand slots only for community desktop artifacts. */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'community-desktop') return
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, CommunityBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, CommunityBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, CommunityBrandMark)
      })))
}
