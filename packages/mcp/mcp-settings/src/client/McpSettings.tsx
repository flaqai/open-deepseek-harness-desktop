/** Built-in MCP editor; configuration mutations remain owned by the Host. */
import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpServerConfig, McpServerView, McpToolView, McpWriteResult } from '../types.ts'
import type { McpLocaleKey } from './locales.ts'
import css from './McpSettings.module.css'

export interface McpSettingsInjected {
  list: () => Promise<McpServerView[]>
  upsert: (config: McpServerConfig) => Promise<McpWriteResult>
  remove: (name: string) => Promise<McpWriteResult>
  setEnabled: (name: string, enabled: boolean) => Promise<McpWriteResult>
  getTools: (name: string) => Promise<McpToolView[]>
}
export type McpSettingsProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.mcp'> & McpSettingsInjected

function stringMap(text: string): Record<string, string> {
  const data: unknown = JSON.parse(text)
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid map')
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string') throw new Error('invalid value')
    result[key] = value
  }
  return result
}

/** Render the current Profile MCP inventory and explicit editing dialogs. */
export function McpSettings(props: McpSettingsProps) {
  const { t } = props
  const [rows, setRows] = useState<McpServerView[]>()
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [restart, setRestart] = useState(false)
  const [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState<McpServerConfig | null>()
  const [removing, setRemoving] = useState<McpServerView>()
  const [tools, setTools] = useState<Record<string, McpToolView[]>>({})
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let current = true
    setError(false)
    void props.list().then((value) => { if (current) setRows(value) }, () => { if (current) setError(true) })
    return () => { current = false }
  }, [props.list, revision])
  const run = async (operation: () => Promise<McpWriteResult>) => {
    setBusy(true); setError(false)
    try {
      const result = await operation()
      if (!alive.current) return
      setRows(result.servers); setRestart(result.application === 'restart-required'); setEditing(undefined); setRemoving(undefined); setTools({})
    } catch { if (alive.current) setError(true) }
    finally { if (alive.current) setBusy(false) }
  }
  return <section className={css.section}>
    <header className={css.header}><div><h2>{t('title')}</h2><p>{t('intro')}</p></div><Button disabled={busy || rows === undefined} onClick={() => { setEditing(null) }}>{t('add')}</Button></header>
    <p className={css.warning}>{t('warning')}</p>
    {error ? <div role="alert"><p>{t('failed')}</p><Button disabled={busy} onClick={() => { setRevision(value => value + 1) }}>{t('retry')}</Button></div> : null}
    {restart ? <p role="status">{t('restart')}</p> : null}
    {rows === undefined && !error ? <p role="status">{t('loading')}</p> : null}
    {rows?.length === 0 ? <p className={css.empty}>{t('empty')}</p> : null}
    {rows?.map(row => <article className={css.card} key={row.id}>
      <div className={css.header}><div><h3>{row.serverName}</h3><p>{row.transport} · {t(row.enabled ? 'enabled' : 'disabled')}</p></div>
        <label className={css.toggle}><input type="checkbox" checked={row.enabled} disabled={!row.editable || busy} onChange={(event) => { void run(() => props.setEnabled(row.serverName, event.target.checked)) }} />{t('enabled')}</label></div>
      <p className={css.code}>{row.transport === 'stdio' ? row.config.command : t('http')}</p>
      {!row.editable ? <p>{t('readOnly')}</p> : null}
      <div className={css.actions}><Button variant="outline" disabled={!row.editable || busy} onClick={() => { setEditing(row.config) }}>{t('edit')}</Button><Button variant="outline" disabled={!row.editable || busy} onClick={() => { setRemoving(row) }}>{t('remove')}</Button><Button variant="outline" disabled={busy} onClick={() => {
        setBusy(true)
        void props.getTools(row.serverName).then(
          (value) => { if (alive.current) setTools(previous => ({ ...previous, [row.id]: value })) },
          () => { if (alive.current) setError(true) },
        ).finally(() => { if (alive.current) setBusy(false) })
      }}>{t('tools')}</Button></div>
      {tools[row.id] === undefined ? null : tools[row.id]?.length === 0 ? <p>{t('noTools')}</p> : <ul>{tools[row.id]?.map(tool => <li key={tool.name}><strong>{tool.name}</strong><p>{tool.description}</p></li>)}</ul>}
    </article>)}
    {editing === undefined ? null : <Editor key={editing?.serverName ?? 'new'} config={editing} t={t} busy={busy} failed={error} onClose={() => { if (!busy) setEditing(undefined) }} onSave={(config) => { void run(() => props.upsert(config)) }} />}
    <Modal open={removing !== undefined} title={t('removeTitle')} closeLabel={t('close')} onClose={() => { if (!busy) setRemoving(undefined) }} footer={<><Button variant="outline" disabled={busy} onClick={() => { setRemoving(undefined) }}>{t('cancel')}</Button><Button disabled={busy} onClick={() => { if (removing) void run(() => props.remove(removing.serverName)) }}>{t('remove')}</Button></>}><p>{t('removeHint')}</p></Modal>
  </section>
}

type EditorProps = {
  config: McpServerConfig | null
  t: (key: McpLocaleKey) => string
  busy: boolean
  failed: boolean
  onClose: () => void
  onSave: (config: McpServerConfig) => void
}
function Editor({ config, t, busy, failed, onClose, onSave }: EditorProps) {
  const [name, setName] = useState(config?.serverName ?? '')
  const [http, setHttp] = useState(config?.transport === 'streamable-http')
  const [command, setCommand] = useState(config?.command ?? '')
  const [args, setArgs] = useState(config?.args?.join('\n') ?? '')
  const [cwd, setCwd] = useState(config?.cwd ?? '')
  const [url, setUrl] = useState(config?.url ?? '')
  const [timeout, setTimeout] = useState(String(config?.toolCallTimeoutMs ?? 60_000))
  const [advanced, setAdvanced] = useState(false)
  const [env, setEnv] = useState(JSON.stringify(config?.env ?? {}, null, 2))
  const [headers, setHeaders] = useState(JSON.stringify(config?.headers ?? {}, null, 2))
  const [invalid, setInvalid] = useState(false)
  const submit = () => {
    try {
      const toolCallTimeoutMs = Number(timeout)
      if (!Number.isSafeInteger(toolCallTimeoutMs) || toolCallTimeoutMs <= 0) throw new Error('invalid timeout')
      if (!/^[A-Za-z0-9_-]{1,32}$/u.test(name) || (http ? !/^https?:\/\//u.test(url) : command.trim() === '')) throw new Error('invalid fields')
      onSave({ ...config, serverName: name, toolCallTimeoutMs, transport: http ? 'streamable-http' : 'stdio', ...(http ? { url } : { command, args: args === '' ? [] : args.split('\n'), cwd }), ...(advanced ? { env: stringMap(env), headers: stringMap(headers) } : {}) })
    } catch { setInvalid(true) }
  }
  return <Modal open title={t(config ? 'edit' : 'add')} closeLabel={t('close')} onClose={onClose} footer={<><Button variant="outline" disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button disabled={busy} onClick={submit}>{t('save')}</Button></>}>
    <div className={css.form}>
      <label>{t('name')}<input data-modal-autofocus value={name} disabled={busy || config !== null} onChange={(event) => { setName(event.target.value) }} /></label>
      <fieldset disabled={busy}><legend>{t('transport')}</legend><label><input type="radio" checked={!http} onChange={() => { setHttp(false) }} />{t('stdio')}</label><label><input type="radio" checked={http} onChange={() => { setHttp(true) }} />{t('http')}</label></fieldset>
      {http ? <label>{t('url')}<input value={url} disabled={busy} onChange={(event) => { setUrl(event.target.value) }} /></label> : <><label>{t('command')}<input value={command} disabled={busy} onChange={(event) => { setCommand(event.target.value) }} /></label><label>{t('args')}<textarea value={args} disabled={busy} onChange={(event) => { setArgs(event.target.value) }} /></label><label>{t('cwd')}<input value={cwd} disabled={busy} onChange={(event) => { setCwd(event.target.value) }} /></label></>}
      <label>{t('timeout')}<input type="number" min={1} step={1} value={timeout} disabled={busy} onChange={(event) => { setTimeout(event.target.value) }} /></label>
      <p>{t('secrets')}</p><label className={css.toggle}><input type="checkbox" checked={advanced} disabled={busy} onChange={(event) => { setAdvanced(event.target.checked) }} />{t('advanced')}</label>
      {advanced ? <><label>{t('env')}<textarea value={env} disabled={busy} onChange={(event) => { setEnv(event.target.value) }} /></label><label>{t('headers')}<textarea value={headers} disabled={busy} onChange={(event) => { setHeaders(event.target.value) }} /></label></> : null}
      {invalid ? <p role="alert">{t('invalid')}</p> : null}
      {failed ? <p role="alert">{t('failed')}</p> : null}
    </div>
  </Modal>
}
