/** Shared-library permissions for authenticated NAS devices. Unknown operations stay denied. */

import type { Context } from '@deepseek-ai/cordis'
import type { RemoteAccessAction, RemoteAccessBinding } from '@deepseek-ai/dsh-api-remote-access'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-fs'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { NasAccess } from './nas-access.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    /** One authenticated NAS device; roles are resolved from live credentials, never from the wire. */
    nas: { readonly kind: 'nas'; readonly deviceId: string }
  }
}

const READ: readonly RemoteAccessAction[] = [
  'session/list', 'session/search', 'session/page', 'session/follow', 'session/projections', 'session/control',
  'session/attachment', 'session/modelCatalog', 'workspace/follow',
  'workspaceFiles/read', 'workspaceFiles/readBytes', 'workspaceFiles/stat', 'workspaceFiles/list', 'workspaceFiles/changes',
  'officeToPdf/render', 'officeToPdf/generation',
  'event:api-session/activity', 'event:api-session/added', 'event:api-session/error', 'event:api-session/removed', 'event:api-session/status',
]
const WRITE: readonly RemoteAccessAction[] = [
  ...READ, 'session/create', 'session/prompt', 'session/selectModel', 'session/rename', 'session/fork',
  'userQuestions/answer', 'userQuestions/attachWait', 'event:user-questions/request',
]

/** Install per-device bindings over each explicitly enumerated shared resource.
 * @param ctx - composition with Remote access, Workspace, and Session persistence.
 * @param access - device credential owner.
 * @returns resolves after persisted identities have been indexed.
 */
export async function installNasPolicy(ctx: Context, access: NasAccess): Promise<void> {
  const stored = await ctx.sessionPersistence.list()
  const sessionIds = new Set(stored.map(entry => entry.header.id))
  const turnOwners = new Map<SessionId, string | null>()
  for (const session of ctx.sessions.list()) sessionIds.add(session.header.id)
  ctx.on('session/created', (session) => {
    sessionIds.add(session.header.id)
    ctx.remoteAccess.invalidate()
  })
  ctx.on('domain/changed', () => { ctx.remoteAccess.invalidate() })
  ctx.on('session/event', (session, event) => {
    if (event.type === 'user/message' && event.data.source.kind === 'user' && !turnOwners.has(session.header.id)) {
      const principal = 'principal' in event.data.source ? event.data.source.principal : undefined
      if (typeof principal === 'object' && principal !== null && 'kind' in principal && principal.kind === 'nas'
        && 'deviceId' in principal && typeof principal.deviceId === 'string') turnOwners.set(session.header.id, principal.deviceId)
      else turnOwners.set(session.header.id, null)
      ctx.remoteAccess.invalidate()
    }
    if (event.type === 'turn/end') {
      turnOwners.delete(session.header.id)
      ctx.remoteAccess.invalidate()
    }
  })
  ctx.remoteAccess.registerPolicy('nas', {
    async allowsFile(principal, path, signal): Promise<boolean> {
      const device = access.device(principal.deviceId)
      if (device === undefined) return false
      const target = await ctx.fs.resolve(path, { signal })
      const canonical = ctx.fs.processPath(target).replaceAll('\\', '/')
      if (canonical.split('/').some(segment => /^\.(?:credentials(?:\.ya?ml)?|env(?:\..*)?|ssh|aws|codex|config|git|bashrc|bash_profile|zprofile|zshrc|profile|gitconfig|npmrc|pnpmrc|netrc)$/iu.test(segment))) return false
      if (ctx.fs.contains(await ctx.fs.resolve(resolveDshHome(), { signal }), target)) return false
      for (const workspace of ctx.workspaceRegistry.list()) {
        if (ctx.fs.contains(await ctx.fs.resolve(workspace.path, { signal }), target)) return true
      }
      return false
    },
    bindings(principal): readonly RemoteAccessBinding[] {
      const device = access.device(principal.deviceId)
      if (device === undefined || device.role === 'admin') return []
      const actions = device.role === 'user' ? WRITE : READ
      const bindings: RemoteAccessBinding[] = [{
        resource: { kind: 'global' }, role: { name: `nas-${device.role}`, resource: 'global', actions },
      }]
      for (const workspace of ctx.workspaceRegistry.list()) {
        bindings.push({ resource: { kind: 'workspace', id: workspace.id },
          role: { name: `nas-${device.role}`, resource: 'workspace', actions } })
        for (const id of workspace.sessionIds) sessionIds.add(id)
      }
      for (const id of sessionIds) {
        bindings.push({ resource: { kind: 'session', id },
          role: { name: `nas-${device.role}`, resource: 'session', actions } })
        if (device.role === 'user' && turnOwners.get(id) === principal.deviceId) {
          bindings.push({ resource: { kind: 'session', id },
            role: { name: 'nas-own-task', resource: 'session', actions: ['session/cancel', 'session/updateQueue'] } })
        }
      }
      return bindings
    },
    explain: () => 'nas-role-forbidden',
  })
}
