/** Exact user-reviewed batch of replacement bundled versions. */
export interface RecoverySourceRepairPlan {
  readonly targets: readonly { readonly packageName: string; readonly version: string }[]
  readonly blocked: readonly { readonly packageName: string }[]
}

type Target = RecoverySourceRepairPlan['targets'][number]

/**
 * Review every target before one batch repair; blocked and cancelled plans never mutate.
 * @param selected - Row identity originally selected by the user.
 * @param actions - Trusted preload plan lookup, confirmation and mutation operations.
 * @returns Whether repair was prepared, cancelled or blocked by unresolved custom sources.
 */
export async function runRecoverySourceRepair(selected: Target, actions: {
  readonly getPlan: () => Promise<RecoverySourceRepairPlan>
  readonly confirm: (targets: readonly Target[]) => boolean
  readonly repair: (selected: Target, approved: readonly Target[]) => Promise<void>
}): Promise<{ readonly state: 'prepared' | 'cancelled' } | { readonly state: 'blocked'; readonly packages: readonly string[] }> {
  const plan = await actions.getPlan()
  if (plan.blocked.length > 0) return { state: 'blocked', packages: plan.blocked.map(item => item.packageName) }
  if (!plan.targets.some(item => item.packageName === selected.packageName && item.version === selected.version)) {
    throw new Error('desktop: installation-source repair plan changed; refresh diagnostics')
  }
  if (!actions.confirm(plan.targets)) return { state: 'cancelled' }
  await actions.repair(selected, plan.targets)
  return { state: 'prepared' }
}
