import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import {
  readImportedPluginRestoreBridge,
  type ImportedPluginRestoreEntry,
  type ImportedPluginRestoreSnapshot,
} from './imported-restore-bridge.ts'
import { restartDesktopApplication } from './bundled-install-bridge.ts'
import css from './ImportedPluginRestore.module.css'
import { PortablePluginExport } from './PortablePluginExport.tsx'

export interface ImportedPluginRestoreInjected {
  readonly development?: boolean
  readonly getRestore: () => Promise<ImportedPluginRestoreSnapshot | undefined>
  readonly checkSources: () => Promise<ImportedPluginRestoreSnapshot | undefined>
  readonly startRestore: (restoreIds: readonly string[]) => Promise<ImportedPluginRestoreSnapshot>
  readonly chooseLocalDirectory: (restoreId: string) => Promise<ImportedPluginRestoreSnapshot | undefined>
  readonly chooseLocalArchive: (restoreId: string) => Promise<ImportedPluginRestoreSnapshot | undefined>
  readonly choosePortableBundle?: () => Promise<ImportedPluginRestoreSnapshot | undefined>
  readonly ignoreRestore: () => Promise<ImportedPluginRestoreSnapshot | undefined>
  readonly restart: () => Promise<boolean>
}

export interface ImportedPluginRestoreProps extends ImportedPluginRestoreInjected {
  readonly t: (key: PluginInventoryLocaleKey, params?: Record<string, string | number>) => string
}

export type ImportedPluginRestoreSectionProps = ImportedPluginRestoreProps & PropsRuntime<'settings.section'>

/** Desktop bridge methods injected into both restore presentations. */
export function importedPluginRestoreInjected(): ImportedPluginRestoreInjected {
  const bridge = readImportedPluginRestoreBridge()
  const choosePortableBundle = bridge?.choosePortableBundle?.bind(bridge)
  return {
    development: bridge?.development === true,
    getRestore: () => bridge?.get() ?? Promise.resolve(undefined),
    checkSources: () => bridge?.checkSources() ?? Promise.resolve(undefined),
    startRestore: ids => bridge === undefined
      ? Promise.reject(new Error('desktop imported plugin bridge is unavailable'))
      : bridge.start(ids),
    chooseLocalDirectory: id => bridge?.chooseLocalDirectory(id) ?? Promise.resolve(undefined),
    chooseLocalArchive: id => bridge?.chooseLocalArchive(id) ?? Promise.resolve(undefined),
    ...(choosePortableBundle === undefined ? {} : {
      choosePortableBundle: () => choosePortableBundle(),
    }),
    ignoreRestore: () => bridge?.ignore() ?? Promise.resolve(undefined),
    restart: restartDesktopApplication,
  }
}

function stateKey(entry: ImportedPluginRestoreEntry): PluginInventoryLocaleKey {
  return `restore.state.${entry.state}`
}

function reasonKey(entry: ImportedPluginRestoreEntry): PluginInventoryLocaleKey | undefined {
  return entry.unsupportedReason === undefined
    ? undefined
    : `restore.reason.${entry.unsupportedReason}`
}

function availabilityKey(entry: ImportedPluginRestoreEntry): PluginInventoryLocaleKey {
  return `restore.availability.${entry.availability}`
}

export type ImportedPluginSourceSimulation =
  | 'checking'
  | 'offline'
  | 'timeout'
  | 'authentication'
  | 'rate-limit'
  | 'not-found'

const SOURCE_SIMULATIONS: readonly ImportedPluginSourceSimulation[] = [
  'checking',
  'offline',
  'timeout',
  'authentication',
  'rate-limit',
  'not-found',
]

/** Produce a renderer-only source-check fixture without mutating the persisted restore snapshot. */
export function simulateImportedPluginSources(
  snapshot: ImportedPluginRestoreSnapshot,
  simulation: ImportedPluginSourceSimulation,
  diagnostic: string,
): ImportedPluginRestoreSnapshot {
  const availability = simulation === 'checking'
    ? 'checking'
    : simulation === 'not-found' ? 'unavailable' : 'unknown'
  return {
    ...snapshot,
    sourceCheckActive: simulation === 'checking',
    entries: snapshot.entries.map((entry) => {
      if (!entry.recoverable
        || entry.unsupportedReason !== undefined
        || entry.availability === 'provided'
        || (entry.state !== 'pending' && entry.state !== 'failed')) return entry
      const { availabilityDiagnostic: _previousDiagnostic, ...base } = entry
      return simulation === 'checking'
        ? { ...base, availability }
        : { ...base, availability, availabilityDiagnostic: diagnostic }
    }),
  }
}

/** Render the dedicated imported-plugin recovery Settings page. */
export function ImportedPluginRestore({
  development = false,
  getRestore,
  checkSources,
  startRestore,
  chooseLocalDirectory,
  chooseLocalArchive,
  choosePortableBundle,
  ignoreRestore,
  restart,
  t,
}: ImportedPluginRestoreProps): ReactNode {
  const titleId = useId()
  const [snapshot, setSnapshot] = useState<ImportedPluginRestoreSnapshot>()
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [failed, setFailed] = useState(false)
  const [portableBusy, setPortableBusy] = useState(false)
  const [portableError, setPortableError] = useState<string>()
  const [sourceSimulation, setSourceSimulation] = useState<ImportedPluginSourceSimulation>()
  const sourceSimulationRef = useRef<ImportedPluginSourceSimulation>()
  const previousAvailability = useRef(new Map<string, ImportedPluginRestoreEntry['availability']>())

  const applySnapshot = useCallback((next: ImportedPluginRestoreSnapshot | undefined) => {
    setSnapshot(next)
    if (next === undefined || sourceSimulationRef.current !== undefined) return
    setSelected((current) => {
      const selectedNext = new Set(current)
      for (const entry of next.entries) {
        const previous = previousAvailability.current.get(entry.restoreId)
        const selectableNow = entry.recoverable
          && (entry.state === 'pending' || entry.state === 'failed')
          && (entry.availability === 'available' || entry.availability === 'unknown')
        if (!selectableNow) selectedNext.delete(entry.restoreId)
        if (entry.availability === 'available' && entry.defaultSelected
          && (previous === undefined || previous === 'checking')) selectedNext.add(entry.restoreId)
        previousAvailability.current.set(entry.restoreId, entry.availability)
      }
      return selectedNext
    })
  }, [])

  const refresh = useCallback(async () => {
    const next = await getRestore()
    applySnapshot(next)
    return next
  }, [applySnapshot, getRestore])

  useEffect(() => {
    let current = true
    void getRestore().then((next) => {
      if (!current) return
      setLoaded(true)
      if (next === undefined) return
      applySnapshot(next)
      void checkSources().then((checked) => {
        if (current) applySnapshot(checked)
      }, () => { if (current) setFailed(true) })
    }, () => {
      if (!current) return
      setLoaded(true)
      setFailed(true)
    })
    return () => { current = false }
  }, [applySnapshot, checkSources, getRestore])

  useEffect(() => {
    if (!snapshot?.active && !snapshot?.sourceCheckActive) return
    const timer = window.setInterval(() => { void refresh().catch(() => { setFailed(true) }) }, 500)
    return () => { window.clearInterval(timer) }
  }, [refresh, snapshot?.active, snapshot?.sourceCheckActive])

  const displayedSnapshot = useMemo(() => {
    if (snapshot === undefined || sourceSimulation === undefined) return snapshot
    return simulateImportedPluginSources(
      snapshot,
      sourceSimulation,
      t(`restore.development.diagnostic.${sourceSimulation}`),
    )
  }, [snapshot, sourceSimulation, t])
  const selectable = useMemo(() => displayedSnapshot?.entries.filter(entry => (
    entry.recoverable && (entry.state === 'pending' || entry.state === 'failed')
      && (entry.availability === 'available' || entry.availability === 'unknown')
  )) ?? [], [displayedSnapshot])
  if (displayedSnapshot === undefined || displayedSnapshot.entries.length === 0) {
    return (
      <>
        <section className={css.surface} data-mode="section" aria-labelledby={titleId}>
          <div className={css.heading}>
            <div>
              <span className={css.eyebrow}>{t('restore.eyebrow')}</span>
              <h3 id={titleId}>{t('restore.title')}</h3>
              <p>{t('restore.description')}</p>
            </div>
          </div>
          <p className={failed ? css.error : css.notice} role={failed ? 'alert' : 'status'}>
            {failed ? t('restore.operationFailed') : loaded ? t('restore.empty') : t('restore.loading')}
          </p>
        </section>
        <PortablePluginExport t={t} />
      </>
    )
  }

  const interactionBlocked = displayedSnapshot.active || portableBusy || sourceSimulation !== undefined
  const hasRemainingEntries = displayedSnapshot.entries.some(entry => (
    entry.state === 'pending' || entry.state === 'failed'
  ))

  const changeSourceSimulation = (next: ImportedPluginSourceSimulation | undefined): void => {
    if (sourceSimulationRef.current === next) return
    sourceSimulationRef.current = next
    setSourceSimulation(next)
    if (next === undefined) {
      previousAvailability.current.clear()
      applySnapshot(snapshot)
    } else {
      setSelected(new Set())
      setFailed(false)
    }
  }

  const toggle = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const start = (): void => {
    setFailed(false)
    void startRestore([...selected]).then(applySnapshot, () => { setFailed(true) })
  }
  const chooseLocal = (entry: ImportedPluginRestoreEntry, kind: 'directory' | 'archive'): void => {
    setFailed(false)
    const operation = kind === 'directory' ? chooseLocalDirectory : chooseLocalArchive
    void operation(entry.restoreId).then(applySnapshot, () => { setFailed(true) })
  }
  const choosePortable = (): void => {
    if (choosePortableBundle === undefined || interactionBlocked) return
    setFailed(false)
    setPortableError(undefined)
    setPortableBusy(true)
    void choosePortableBundle().then(applySnapshot, (error: unknown) => {
      setFailed(true)
      setPortableError(error instanceof Error ? error.message.slice(0, 300) : undefined)
    }).finally(() => { setPortableBusy(false) })
  }
  const body = (
    <section
      className={css.surface}
      data-mode="section"
      aria-busy={displayedSnapshot.active || displayedSnapshot.sourceCheckActive || portableBusy}
      aria-labelledby={titleId}
    >
      <div className={css.heading}>
        <div>
          <span className={css.eyebrow}>{t('restore.eyebrow')}</span>
          <h3 id={titleId}>{t('restore.title')}</h3>
          <p>{t('restore.description')}</p>
        </div>
        <span className={css.count}>{displayedSnapshot.entries.length}</span>
      </div>
      {displayedSnapshot.sourceIssues.length > 0 ? (
        <p className={css.notice} role="status">{t('restore.sourceIssue')}</p>
      ) : null}
      <div className={css.sourceCheck}>
        <span>{portableBusy ? t('restore.portableBusy') : displayedSnapshot.sourceCheckActive
          ? t('restore.checkingSources') : t('restore.sourcesChecked')}</span>
        {choosePortableBundle !== undefined ? (
          <button type="button" disabled={interactionBlocked} onClick={choosePortable}>
            {t('restore.portableBundle')}
          </button>
        ) : null}
        <button type="button" disabled={interactionBlocked || displayedSnapshot.sourceCheckActive} onClick={() => {
          setFailed(false)
          void checkSources().then(applySnapshot, () => { setFailed(true) })
        }}>{t('restore.recheckSources')}</button>
      </div>
      {development ? (
        <section className={css.developmentFixtures} aria-label={t('restore.development.title')}>
          <div>
            <strong>{t('restore.development.title')}</strong>
            <span>{t('restore.development.description')}</span>
          </div>
          <div className={css.developmentButtons}>
            <button
              type="button"
              aria-pressed={sourceSimulation === undefined}
              onClick={() => { changeSourceSimulation(undefined) }}
            >{t('restore.development.real')}</button>
            {SOURCE_SIMULATIONS.map(simulation => (
              <button
                key={simulation}
                type="button"
                aria-pressed={sourceSimulation === simulation}
                onClick={() => { changeSourceSimulation(simulation) }}
              >{t(`restore.development.${simulation}`)}</button>
            ))}
          </div>
        </section>
      ) : null}
      <div className={css.groups}>
        {(['plugin', 'external-tool'] as const).map((category) => {
          const entries = displayedSnapshot.entries.filter(entry => entry.category === category)
          if (entries.length === 0) return null
          return (
            <div className={css.group} key={category}>
              <div className={css.groupHeading}>
                <strong>{t(category === 'plugin' ? 'restore.group.plugins' : 'restore.group.tools')}</strong>
                {category === 'plugin' && selectable.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      const all = selectable.filter(entry => entry.category === 'plugin')
                      const selectAll = all.some(entry => !selected.has(entry.restoreId))
                      setSelected((current) => {
                        const next = new Set(current)
                        for (const entry of all) {
                          if (selectAll) next.add(entry.restoreId)
                          else next.delete(entry.restoreId)
                        }
                        return next
                      })
                    }}
                  >{t('restore.selectAll')}</button>
                ) : null}
              </div>
              <ul className={css.entries}>
                {entries.map((entry) => {
                  const selectableEntry = entry.recoverable && (entry.state === 'pending' || entry.state === 'failed')
                    && (entry.availability === 'available' || entry.availability === 'unknown')
                  const reason = reasonKey(entry)
                  const canUseLocal = entry.category === 'plugin'
                    && (entry.state === 'pending' || entry.state === 'failed')
                  return (
                    <li key={entry.restoreId} data-state={entry.state}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selected.has(entry.restoreId)}
                          disabled={!selectableEntry || displayedSnapshot.active}
                          onChange={() => { toggle(entry.restoreId) }}
                        />
                        <span>
                          <strong>{entry.packageName}</strong>
                          <code>{entry.declaredSpec}</code>
                        </span>
                      </label>
                      <span className={css.entryState}>{entry.state === 'pending'
                        ? reason === undefined ? t(availabilityKey(entry)) : t(reason)
                        : t(stateKey(entry))}</span>
                      {entry.availabilityDiagnostic !== undefined ? (
                        <details><summary>{t('restore.sourceDetails')}</summary><pre>{entry.availabilityDiagnostic}</pre></details>
                      ) : null}
                      {entry.state === 'failed' && entry.diagnostic !== undefined ? (
                        <details><summary>{t('restore.failureDetails')}</summary><pre>{entry.diagnostic}</pre></details>
                      ) : null}
                      {canUseLocal ? (
                        <div className={css.localActions}>
                          <button type="button" disabled={interactionBlocked} onClick={() => { chooseLocal(entry, 'directory') }}>
                            {t('restore.localDirectory')}
                          </button>
                          <button type="button" disabled={interactionBlocked} onClick={() => { chooseLocal(entry, 'archive') }}>
                            {t('restore.localArchive')}
                          </button>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
      {failed ? <p className={css.error} role="alert">{portableError ?? t('restore.operationFailed')}</p> : null}
      <div className={css.actions}>
        {displayedSnapshot.restartRequired ? (
          <Button variant="primary" disabled={sourceSimulation !== undefined} onClick={() => { void restart() }}>{t('restore.restart')}</Button>
        ) : (
          <Button variant="primary" disabled={selected.size === 0 || interactionBlocked} onClick={start}>
            {displayedSnapshot.active ? t('restore.installing') : t('restore.install')}
          </Button>
        )}
        {hasRemainingEntries ? (
          <Button variant="outline" disabled={interactionBlocked} onClick={() => {
            void ignoreRestore().then(applySnapshot)
          }}>{t('restore.ignore')}</Button>
        ) : null}
      </div>
    </section>
  )
  return <>{body}<PortablePluginExport t={t} /></>
}

/** Dedicated Settings page for imported plugin recovery. */
export function ImportedPluginRestoreSection(props: ImportedPluginRestoreSectionProps): ReactNode {
  return <ImportedPluginRestore {...props} />
}
