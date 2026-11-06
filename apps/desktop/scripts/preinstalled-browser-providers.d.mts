/** Desktop-carried providers whose Profile bundles remain opt-in. */
export const PREINSTALLED_BROWSER_PROVIDERS: readonly [string, string]
/**
 * Verify expanded browser connector dependencies without importing their code.
 * @param root Expanded Harness runtime root after deployment and pruning.
 * @returns Returns after identities and the browser-free payload policy pass.
 */
export function verifyPreinstalledBrowserProviders(root: string): void

/**
 * Verify the optional native Computer Use resources without loading code or requesting OS permissions.
 * @param root Expanded Harness runtime root after platform pruning.
 * @param target Supported native target, for example darwin-arm64 or win32-x64.
 * @returns Returns after the native SDK, library, addon, resolver and notice checks pass.
 */
export function verifyPreinstalledComputerUse(root: string, target: string): void
