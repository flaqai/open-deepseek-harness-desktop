/** UI-safe account projection used by the isolated native welcome window. */
export interface AccountView {
  readonly status: 'signed-out' | 'credential-stored'
  readonly links: { readonly usageUrl: string; readonly topUpUrl: string }
  readonly attempt: null | {
    readonly id: string
    readonly phase: 'initializing' | 'waiting-browser' | 'exchanging' | 'committing' | 'succeeded' | 'cancelled' | 'expired' | 'failed'
    readonly authorizeUrl?: string
    readonly expiresAt?: number
    readonly errorCode?: 'network' | 'protocol' | 'expired' | 'storage'
  }
}

export type SignInAttemptId = string

export interface AccountClientMetadata {
  readonly version: string
  readonly locale: string
  readonly timezoneOffsetSeconds: number
}
