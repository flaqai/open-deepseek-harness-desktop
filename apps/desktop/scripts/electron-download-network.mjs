/** Download-only proxy environment; never changes the application's network policy. */
import { execFileSync } from 'node:child_process'

function macSystemProxy() {
  try { return execFileSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }) }
  catch { return '' }
}

/**
 * Enable Electron's opt-in proxy support and, on macOS, adopt enabled system HTTP proxies.
 * Explicit environment settings and an explicitly disabled Electron proxy switch take precedence.
 * @param {NodeJS.ProcessEnv} environment Parent environment, left unchanged.
 * @param {string} platform Host platform.
 * @param {() => string} readSystemProxy Bounded macOS system-proxy reader.
 * @returns {NodeJS.ProcessEnv} Environment only for Electron's installer child.
 */
export function electronDownloadEnvironment(environment = process.env, platform = process.platform, readSystemProxy = macSystemProxy) {
  const env = { ...environment }
  if (env.ELECTRON_GET_USE_PROXY === '') return env
  const explicit = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'GLOBAL_AGENT_HTTP_PROXY', 'GLOBAL_AGENT_HTTPS_PROXY', 'ALL_PROXY', 'all_proxy']
    .some(key => Boolean(env[key]))
  if (!explicit && platform === 'darwin' && env.ODSH_USE_SYSTEM_PROXY !== '0') {
    const values = new Map([...readSystemProxy().matchAll(/^\s*(HTTPSEnable|HTTPSProxy|HTTPSPort|HTTPEnable|HTTPProxy|HTTPPort)\s*:\s*(\S+)\s*$/gmu)].map(match => [match[1], match[2]]))
    for (const [prefix, key] of [['HTTP', 'HTTP_PROXY'], ['HTTPS', 'HTTPS_PROXY']]) {
      const host = values.get(`${prefix}Proxy`)
      const port = values.get(`${prefix}Port`)
      if (values.get(`${prefix}Enable`) !== '1' || !host || !port || !/^\d+$/u.test(port) || Number(port) < 1 || Number(port) > 65535) continue
      try {
        const proxy = new URL(`http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`)
        if (proxy.username || proxy.password || proxy.pathname !== '/' || proxy.search || proxy.hash) continue
        env[key] = proxy.origin
      } catch { /* Invalid system proxy settings do not become a download route. */ }
    }
  }
  if (['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'GLOBAL_AGENT_HTTP_PROXY', 'GLOBAL_AGENT_HTTPS_PROXY'].some(key => Boolean(env[key]))) {
    env.ELECTRON_GET_USE_PROXY ??= '1'
  }
  return env
}
