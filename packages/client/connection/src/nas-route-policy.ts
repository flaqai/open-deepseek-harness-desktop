/** NAS admission for raw plugin routes that do not pass through the Gateway. */

import type { WebRequestGuard } from '@deepseek-ai/dsh-host-webserver'
import type { NasAccess } from './nas-access.ts'
import { isTrustedApiRequest } from './api-request-trust.ts'

const NAS_ROUTES = new Set(['/nas/health', '/nas/pair', '/nas/devices', '/nas/invitations', '/nas/device-role', '/nas/me'])
const CONNECTION_ROUTES = new Set(['/api', '/connect'])

/**
 * Reject unclassified raw plugin routes for restricted devices before their handlers run.
 * @param access - live NAS credential owner.
 * @param trustedHosts - configured authorities used by the deployment's Host/Origin fence.
 * @returns a guard allowing public frontend reads and classified Connection/NAS routes; those handlers retain their own authorization.
 */
export function nasRouteGuard(access: Pick<NasAccess, 'authenticate'>, trustedHosts: readonly string[]): WebRequestGuard {
  return ({ request, kind, pathname, routePath }) => {
    if (!isTrustedApiRequest(request, trustedHosts)) return false
    // Gateway performs live connection admission and per-resource authorization.
    if (kind === 'upgrade' && pathname === '/api/remote.mux' && routePath === '/api/remote.mux') return true
    if (kind === 'http' && CONNECTION_ROUTES.has(routePath ?? '')) return true
    if (kind === 'http' && NAS_ROUTES.has(pathname) && routePath === pathname) return true
    const read = request.method === 'GET' || request.method === 'HEAD'
    if (kind === 'http' && read && (routePath === undefined || routePath === '/plugins' || routePath === '/plugins/events')) return true
    return access.authenticate(request)?.role === 'admin'
  }
}
