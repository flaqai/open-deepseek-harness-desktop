import { BrandWordmark, FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

type CommunityBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/** Render the community desktop whale mark at the host-requested size. */
export function CommunityBrandMark({ size, className }: CommunityBrandMarkProps) {
  return <FishLogo size={size} className={className} />
}

/** Render the application wordmark independently from its mark. */
export function CommunityBrandName() {
  return <BrandWordmark includeMark={false} />
}
