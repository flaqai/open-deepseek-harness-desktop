/** Core service packages supplied by the installation, never by stale Profile copies. */
export const INSTALLATION_OWNED_CORE_PACKAGES: ReadonlySet<string> = new Set([
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-tool-subagent',
])
