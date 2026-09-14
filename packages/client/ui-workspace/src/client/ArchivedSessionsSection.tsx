/** Settings page for finding and restoring archived Sessions. */

import { useMemo, useState, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  Button, IconFolderClose16, IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ArchivedSessionsSection.module.css'

/** Restore operations supplied by the Workspace plugin apply layer. */
export interface ArchivedSessionsSectionInjected {
  /** Remove one Session from the Host archive set. */
  restoreSession: (sessionId: SessionId) => Promise<void>
}

/** Full props assembled by the Settings section slot. */
export type ArchivedSessionsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'workspace'>
  & InjectFace<ArchivedSessionsSectionInjected>

interface ArchivedRow {
  readonly id: SessionId
  readonly title: string
  readonly updatedAt?: number
}

interface ArchivedGroup {
  readonly id: string
  readonly title: string
  readonly rows: readonly ArchivedRow[]
}

const ALL_WORKSPACES = '__all__'
const UNGROUPED_WORKSPACE = '__ungrouped__'

/** Render archived Sessions grouped by their retained Workspace positions. */
export function ArchivedSessionsSection({
  restoreSession, useSessions, useWorkspaces, t,
}: ArchivedSessionsSectionProps): ReactNode {
  const sessions = useSessions(value => value)
  const workspaces = useWorkspaces(value => value)
  const [query, setQuery] = useState('')
  const [workspaceFilter, setWorkspaceFilter] = useState(ALL_WORKSPACES)
  const [busy, setBusy] = useState<SessionId | 'all' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const groups = useMemo<readonly ArchivedGroup[]>(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const rowsByWorkspace = new Map<string, ArchivedRow[]>()
    for (const id of workspaces.archivedSessionIds) {
      const summary = sessions.byId[id]
      const title = summary?.displayTitle ?? String(id)
      if (normalized !== ''
        && !title.toLocaleLowerCase().includes(normalized)
        && !String(id).toLocaleLowerCase().includes(normalized)) continue
      const owner = workspaces.items.find(workspace => workspace.sessionIds.includes(id))
      const ownerId = owner === undefined ? UNGROUPED_WORKSPACE : String(owner.workspaceId)
      if (workspaceFilter !== ALL_WORKSPACES && workspaceFilter !== ownerId) continue
      const rows = rowsByWorkspace.get(ownerId) ?? []
      rows.push({ id, title, ...summary === undefined ? {} : { updatedAt: summary.updatedAt } })
      rowsByWorkspace.set(ownerId, rows)
    }
    const projected: ArchivedGroup[] = []
    for (const workspace of workspaces.items) {
      const rows = rowsByWorkspace.get(String(workspace.workspaceId))
      if (rows === undefined) continue
      projected.push({ id: String(workspace.workspaceId), title: workspace.title, rows: [...rows].sort(compareRows) })
    }
    const ungrouped = rowsByWorkspace.get(UNGROUPED_WORKSPACE)
    if (ungrouped !== undefined) {
      projected.push({ id: UNGROUPED_WORKSPACE, title: t('group.ungrouped'), rows: [...ungrouped].sort(compareRows) })
    }
    return projected
  }, [query, sessions.byId, t, workspaceFilter, workspaces.archivedSessionIds, workspaces.items])

  const restore = async (sessionId: SessionId): Promise<void> => {
    if (busy !== null) return
    setBusy(sessionId)
    setError(null)
    try {
      await restoreSession(sessionId)
    } catch {
      setError(t('archive.restoreFailed'))
    } finally {
      setBusy(null)
    }
  }
  const restoreAll = async (): Promise<void> => {
    if (busy !== null || workspaces.archivedSessionIds.length === 0) return
    setBusy('all')
    setError(null)
    try {
      for (const sessionId of workspaces.archivedSessionIds) await restoreSession(sessionId)
    } catch {
      setError(t('archive.restoreFailed'))
    } finally {
      setBusy(null)
    }
  }

  const loading = sessions.phase !== 'ready' || workspaces.phase !== 'ready'
  const archivedCount = workspaces.archivedSessionIds.length
  return (
    <section className={css.section}>
      <header className={css.intro}>
        <div>
          <h2>{t('archive.title')}</h2>
          <p>{t('archive.description')}</p>
        </div>
        <Button variant="outline" size="sm" disabled={busy !== null || archivedCount === 0} onClick={() => { void restoreAll() }}>
          {busy === 'all' ? t('archive.restoring') : t('archive.restoreAll')}
        </Button>
      </header>

      <div className={css.toolbar}>
        <label className={css.search}>
          <IconSearchOutline16 aria-hidden="true" />
          <span className={css.visuallyHidden}>{t('archive.search.aria')}</span>
          <input value={query} placeholder={t('archive.search.placeholder')} onChange={(event) => { setQuery(event.currentTarget.value) }} />
        </label>
        <label className={css.filter}>
          <span className={css.visuallyHidden}>{t('archive.workspaceFilter')}</span>
          <select value={workspaceFilter} onChange={(event) => { setWorkspaceFilter(event.currentTarget.value) }}>
            <option value={ALL_WORKSPACES}>{t('archive.allWorkspaces')}</option>
            {workspaces.items.map(workspace => (
              <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>
            ))}
            <option value={UNGROUPED_WORKSPACE}>{t('group.ungrouped')}</option>
          </select>
        </label>
      </div>

      {error !== null && <p className={css.error} role="alert">{error}</p>}
      {loading
        ? <p className={css.empty} role="status">{t('archive.loading')}</p>
        : groups.length === 0
          ? (
            <div className={css.empty} role="status">
              <strong>{archivedCount === 0 ? t('archive.empty.title') : t('archive.noMatches.title')}</strong>
              <span>{archivedCount === 0 ? t('archive.empty.description') : t('archive.noMatches.description')}</span>
            </div>
          )
          : (
            <div className={css.groups}>
              {groups.map(group => (
                <section key={group.id} className={css.group} aria-labelledby={`archive-group-${group.id}`}>
                  <div className={css.groupHeader}>
                    <span className={css.groupTitle} id={`archive-group-${group.id}`}>
                      <IconFolderClose16 size={16} />
                      {group.title}
                    </span>
                    <span>{t(group.rows.length === 1 ? 'sessions.count.one' : 'sessions.count.other', { n: group.rows.length })}</span>
                  </div>
                  <ul className={css.list}>
                    {group.rows.map(row => (
                      <li key={row.id} className={css.row}>
                        <div className={css.rowText}>
                          <strong>{row.title}</strong>
                          <span>{row.updatedAt === undefined ? t('archive.dateUnknown') : new Date(row.updatedAt).toLocaleString()}</span>
                        </div>
                        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => { void restore(row.id) }}>
                          {busy === row.id ? t('archive.restoring') : t('archive.restore')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
    </section>
  )
}

function compareRows(left: ArchivedRow, right: ArchivedRow): number {
  return (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
}
