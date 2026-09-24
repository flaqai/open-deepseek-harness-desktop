import { useState, type ReactNode } from 'react'
import type { PluginInventoryLocaleKey } from './locales.ts'
import { readImportedPluginRestoreBridge, type ImportedPluginRestoreBridge } from './imported-restore-bridge.ts'
import css from './PortablePluginExport.module.css'

type Target = {
  platform: 'darwin' | 'win32' | 'linux'
  architecture: 'arm64' | 'x64'
  osVersion: string
}
type Source = NonNullable<Awaited<ReturnType<NonNullable<ImportedPluginRestoreBridge['inspectExport']>>>>

const OS_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+ -]{0,39}$/u
const REASONS = {
  'external-tool': 'portableExport.reason.external-tool',
  'missing-installation': 'portableExport.reason.missing-installation',
  'invalid-installation': 'portableExport.reason.invalid-installation',
  'custom-source': 'portableExport.reason.custom-source',
  'missing-archive': 'portableExport.reason.missing-archive',
} as const satisfies Record<string, PluginInventoryLocaleKey>

/** Source selection and destination targeting remain separate from the imported restore transaction. */
export function PortablePluginExport({ t }: {
  readonly t: (key: PluginInventoryLocaleKey) => string
}): ReactNode {
  const bridge = readImportedPluginRestoreBridge()
  const [source, setSource] = useState<Source>()
  const [target, setTarget] = useState<Target>({ platform: 'win32', architecture: 'x64', osVersion: '' })
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()
  if (typeof bridge?.inspectExport !== 'function' || typeof bridge.exportBundle !== 'function') return null

  const chooseSource = (): void => {
    if (typeof bridge.inspectExport !== 'function') return
    setBusy(true); setError(undefined); setSaved(false)
    void bridge.inspectExport().then((next) => {
      if (next === undefined) return
      setSource(next)
      setTarget(next.host)
      setSelected(new Set(next.candidates.map(item => item.packageName)))
    }, (reason: unknown) => { setError(reason instanceof Error ? reason.message.slice(0, 300) : String(reason)) })
      .finally(() => { setBusy(false) })
  }
  const exportBundle = (): void => {
    if (typeof bridge.exportBundle !== 'function') return
    if (source === undefined || selected.size === 0 || !OS_VERSION.test(target.osVersion) || busy) return
    setBusy(true); setError(undefined); setSaved(false)
    void bridge.exportBundle({ selectionId: source.selectionId, target, packageNames: [...selected] })
      .then((result) => { setSaved(result.status === 'saved') }, (reason: unknown) => {
        setError(reason instanceof Error ? reason.message.slice(0, 300) : String(reason))
      }).finally(() => { setBusy(false) })
  }
  return (
    <section className={css.surface} aria-busy={busy}>
      <h3>{t('portableExport.title')}</h3>
      <p>{t('portableExport.description')}</p>
      <button type="button" disabled={busy} onClick={chooseSource}>{t('portableExport.source')}</button>
      {source === undefined ? null : (
        <>
          {source.candidates.length === 0 ? <p role="status">{t('portableExport.empty')}</p> : (
            <div className={css.candidates}>
              {source.candidates.map(item => (
                <label key={item.packageName}>
                  <input type="checkbox" checked={selected.has(item.packageName)} disabled={busy} onChange={() => {
                    setSelected((current) => {
                      const next = new Set(current)
                      if (next.has(item.packageName)) next.delete(item.packageName)
                      else next.add(item.packageName)
                      return next
                    })
                  }} />
                  <span>{item.packageName}@{item.version}</span>
                </label>
              ))}
            </div>
          )}
          {source.omitted.length === 0 ? null : (
            <details><summary>{t('portableExport.omitted')}</summary><ul>
              {source.omitted.map(item => <li key={item.packageName}>{item.packageName} — {
                t(REASONS[item.reason as keyof typeof REASONS])
              }</li>)}
            </ul></details>
          )}
          <div className={css.target}>
            <label>{t('portableExport.platform')}
              <select disabled={busy} value={target.platform} onChange={(event) => {
                setTarget(current => ({ ...current, platform: event.target.value as Target['platform'], osVersion: '' }))
              }}>
                <option value="win32">Windows</option><option value="darwin">macOS</option><option value="linux">Linux</option>
              </select>
            </label>
            <label>{t('portableExport.architecture')}
              <select disabled={busy} value={target.architecture} onChange={(event) => {
                setTarget(current => ({ ...current, architecture: event.target.value as Target['architecture'] }))
              }}>
                <option value="x64">x64</option><option value="arm64">arm64</option>
              </select>
            </label>
            <label>{t('portableExport.version')}
              <input disabled={busy} value={target.osVersion} maxLength={40} onChange={(event) => {
                setTarget(current => ({ ...current, osVersion: event.target.value }))
              }} />
            </label>
          </div>
          <p className={css.hint}>{t('portableExport.versionHint')}</p>
          <button type="button" disabled={busy || selected.size === 0 || !OS_VERSION.test(target.osVersion)} onClick={exportBundle}>
            {t('portableExport.prepare')}
          </button>
        </>
      )}
      {busy ? <p role="status">{t('portableExport.busy')}</p> : null}
      {saved ? <p role="status">{t('portableExport.saved')}</p> : null}
      {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
    </section>
  )
}
