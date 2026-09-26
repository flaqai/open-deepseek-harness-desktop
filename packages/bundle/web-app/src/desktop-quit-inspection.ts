/** Read-only quit inspection for a community Desktop-owned local Web Host. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-schedule'
import type {} from '@deepseek-ai/dsh-client-connection'

/** Minimal facts needed to explain the effect of stopping the local Host. */
export interface DesktopQuitInspection {
  readonly activeTasks: boolean
  readonly scheduledTasks: boolean
}

/**
 * Limit registration to the community supervisor's local Web invocation.
 * @param ownerPid - Supervisor marker placed only on its Harness child.
 * @param bindHost - Web server bind address.
 * @param nasEnabled - Whether this Web invocation serves NAS devices.
 * @returns True only for a positive owner PID, loopback bind, and no NAS carrier.
 */
export function mayExposeDesktopQuitInspection(ownerPid: string | undefined, bindHost: string, nasEnabled: boolean): boolean {
  return ownerPid !== undefined && /^[1-9]\d*$/u.test(ownerPid)
    && bindHost === '127.0.0.1' && !nasEnabled
}

/**
 * Inspect live work and all enabled reminders without activating a Session.
 * @param ctx - Ready Web Host context with Agent and Job services.
 * @returns Facts about work that stopping this Host would interrupt or defer.
 */
export async function inspectDesktopQuit(ctx: Context): Promise<DesktopQuitInspection> {
  const agents = ctx.get('agents')
  const jobs = ctx.get('jobs')
  const schedule = ctx.get('schedule')
  if (agents === undefined || jobs === undefined) {
    throw new Error('desktop quit: required task services are unavailable')
  }
  const liveAgents = agents.list()
  const activeTasks = liveAgents.some(agent => agent.status === 'running'
    || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0)
    || [undefined, ...liveAgents].some(agent => jobs.list(agent?.id)
      .some(job => job.status === 'running' || job.status === 'stopping'))
  // Schedule is an optional, disabled-by-default Web row. Without its Service
  // no reminder timer is armed in this Host; when enabled, read every stored
  // row, including Sessions not currently loaded by the Agent registry.
  const scheduledTasks = schedule === undefined ? false
    : (await schedule.catalog()).some(task => task.status === 'active')
  return { activeTasks, scheduledTasks }
}

/**
 * Mount one authenticated exact GET route only for the Desktop-owned local Web invocation.
 * The shared Connection rejects an untrusted Host or a missing browser session before dispatch.
 * @param ctx - Web plugin context that owns the route lifetime.
 */
export function installDesktopQuitInspectionRoute(ctx: Context): void {
  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.effect(() => connectionCtx.connection.fetch.register({
      path: '/api/desktop.quit-inspection',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          return Response.json(await inspectDesktopQuit(connectionCtx), {
            headers: { 'Cache-Control': 'no-store' },
          })
        } catch (error) {
          connectionCtx.logger.warn('desktop quit: inspection failed', error)
          return Response.json({ error: 'inspection_unavailable' }, {
            status: 503, headers: { 'Cache-Control': 'no-store' },
          })
        }
      },
    }), 'web-app: Desktop quit inspection route')
  })
}
