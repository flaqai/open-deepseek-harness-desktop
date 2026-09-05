import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { iconPresentation, type DesktopIconsBridge, type DesktopIconStatus, type IconCrop, type IconSelection, type IconTarget, type IconPresentation } from './icon-protocol.ts'
import { centerIconCrop, clampIconCrop, zoomIconCrop } from './icon-crop.ts'
import css from './DesktopIconSettings.module.css'

type Translate = PropsLocale<'desktop-shell'>['t']
interface Selection extends IconSelection { target: IconTarget }

function CropPreview({ selection, crop, size, presentation }: {
  selection: IconSelection
  crop: IconCrop
  size: number
  presentation: IconPresentation
}) {
  return <span className={css.preview} style={{ width: size, height: size }}>
    <span className={css.previewCrop} style={{
      inset: `${presentation.inset / 512 * 100}%`,
      borderRadius: `${presentation.radius / (512 - 2 * presentation.inset) * 100}%`,
    }}>
      <img src={selection.preview} alt="" draggable={false} style={{
        width: `${selection.width / crop.size * 100}%`, maxWidth: 'none',
        left: `${-crop.x / crop.size * 100}%`, top: `${-crop.y / crop.size * 100}%`,
      }} /></span>
  </span>
}

function IconCropDialog({ selection, platform, t, busy, error, onCancel, onConfirm }: {
  selection: Selection
  platform: string
  t: Translate
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (crop: IconCrop) => void
}) {
  const presentation = iconPresentation(platform, selection.target)
  const [crop, setCrop] = useState(() => centerIconCrop(selection.width, selection.height))
  const [zoom, setZoom] = useState(1)
  const viewport = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const pointer = useRef<{ id: number; x: number; y: number; crop: IconCrop; scale: number } | null>(null)
  const frame = useRef<number | null>(null)
  const pending = useRef<IconCrop | null>(null)
  const flush = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    if (pending.current !== null) { setCrop(pending.current); pending.current = null }
  }, [])
  useEffect(() => {
    const previous = document.activeElement
    viewport.current?.focus()
    const trap = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const dialog = body.current?.closest('[role="dialog"]')
      const elements = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])
      const index = elements.indexOf(document.activeElement as HTMLElement)
      const next = event.shiftKey ? (index <= 0 ? elements.length - 1 : index - 1) : (index + 1) % elements.length
      event.preventDefault()
      elements[next]?.focus()
    }
    document.addEventListener('keydown', trap)
    return () => {
      document.removeEventListener('keydown', trap)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])
  return <Modal open title={t('icons.crop.title')} closeLabel={t('icons.cancel')} onClose={() => { if (!busy) onCancel() }}
    className={css.modal ?? ''} contentClassName={css.modalContent ?? ''}
    description={t('icons.crop.description')}
    footer={<div className={css.actions}><Button disabled={busy} onClick={onCancel}>{t('icons.cancel')}</Button>
      <Button variant="primary" disabled={busy} onClick={() => { const finalCrop = pending.current ?? crop; flush(); onConfirm(finalCrop) }}>{t('icons.confirm')}</Button></div>}>
    <div ref={body} className={css.editor}>
      <div ref={viewport} role="group" tabIndex={0} aria-label={t('icons.crop.move')} className={css.viewport}
        onKeyDown={(event) => {
          const delta = event.shiftKey ? 10 : 1
          const offsets: Partial<Record<string, readonly [number, number]>> = {
            ArrowLeft: [delta, 0], ArrowRight: [-delta, 0], ArrowUp: [0, delta], ArrowDown: [0, -delta],
          }
          const offset = offsets[event.key]
          if (offset === undefined || busy) return
          event.preventDefault()
          setCrop(current => clampIconCrop({
            ...current, x: current.x + offset[0], y: current.y + offset[1],
          }, selection.width, selection.height))
        }}
        onPointerDown={(event) => {
          if (busy || event.button !== 0) return
          flush()
          event.preventDefault()
          event.currentTarget.focus()
          event.currentTarget.setPointerCapture(event.pointerId)
          pointer.current = {
            id: event.pointerId, x: event.clientX, y: event.clientY, crop,
            scale: crop.size / event.currentTarget.getBoundingClientRect().width,
          }
        }}
        onPointerMove={(event) => {
          const start = pointer.current
          if (start === null || start.id !== event.pointerId) return
          pending.current = clampIconCrop({
            ...start.crop,
            x: start.crop.x - (event.clientX - start.x) * start.scale,
            y: start.crop.y - (event.clientY - start.y) * start.scale,
          }, selection.width, selection.height)
          if (frame.current === null) frame.current = requestAnimationFrame(flush)
        }}
        onPointerUp={(event) => { if (pointer.current?.id === event.pointerId) { flush(); pointer.current = null } }}
        onPointerCancel={() => { flush(); pointer.current = null }}
        onLostPointerCapture={() => { flush(); pointer.current = null }}>
        <img src={selection.preview} alt="" draggable={false} style={{ width: `${selection.width / crop.size * 100}%`, maxWidth: 'none', left: `${-crop.x / crop.size * 100}%`, top: `${-crop.y / crop.size * 100}%` }} />
        <span className={css.grid} aria-hidden="true" />
      </div>
      <label className={css.zoom}>{t('icons.crop.zoom')}<input type="range" min="1" max="4" step="0.05" value={zoom} disabled={busy}
        onChange={(event) => {
          const value = Number(event.target.value)
          setZoom(value)
          setCrop(current => zoomIconCrop(current, selection.width, selection.height, value))
        }} /></label>
      <Button disabled={busy} onClick={() => { setCrop(centerIconCrop(selection.width, selection.height, zoom)) }}>{t('icons.crop.center')}</Button>
      <div className={css.previews} aria-label={t('icons.crop.preview')}>
        <CropPreview selection={selection} crop={crop} size={64} presentation={presentation} />
        {['light', 'dark'].map(background => <div key={background} className={css.sample} data-background={background}>
          <CropPreview selection={selection} crop={crop} size={32} presentation={presentation} />
          <CropPreview selection={selection} crop={crop} size={16} presentation={presentation} />
          <span>{t('icons.crop.sizes')}</span>
        </div>)}
      </div>
      <p className={css.hint}>{t('icons.crop.finish')}</p>
      {crop.size < 512 && <p className={css.hint}>{t('icons.crop.small')}</p>}
      {error !== null && <p role="alert" className={css.error}>{error}</p>}
    </div>
  </Modal>
}

/** Edit local OS icons without changing Harness configuration or the app's internal branding. */
export function DesktopIconSettings({ bridge, t }: { bridge: DesktopIconsBridge; t: Translate }) {
  const [status, setStatus] = useState<DesktopIconStatus | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const selected = useRef<Selection | null>(null)
  const active = useRef(true)
  const errorText = (reason: unknown): string => {
    const code = reason instanceof Error ? /icon\.([a-z-]+)/.exec(reason.message)?.[1] : undefined
    if (code === 'too-large') return t('icons.error.size')
    if (code === 'too-many-pixels') return t('icons.error.pixels')
    if (code === 'expired') return t('icons.error.expired')
    if (code === 'invalid-image') return t('icons.error.image')
    if (code === 'invalid-crop') return t('icons.error.crop')
    return t('icons.error.generic')
  }
  useEffect(() => {
    active.current = true
    let live = true
    void bridge.getStatus().then((next) => { if (live) setStatus(next) }, () => { if (live) setLoadFailed(true) })
    const unsubscribe = bridge.onStatus((next) => { if (live) setStatus(next) })
    return () => {
      live = false
      active.current = false
      unsubscribe()
      if (selected.current !== null) void bridge.discard(selected.current.id).catch(() => {})
    }
  }, [bridge])
  const run = async (operation: () => Promise<DesktopIconStatus>): Promise<boolean> => {
    setBusy(true); setError(null)
    try { const next = await operation(); if (active.current) setStatus(next); return true }
    catch (reason) { if (active.current) setError(errorText(reason)); return false }
    finally { if (active.current) setBusy(false) }
  }
  const choose = async (target: IconTarget): Promise<void> => {
    setBusy(true); setError(null)
    try {
      const picked = await bridge.choose()
      if (picked !== null) {
        if (!active.current) { await bridge.discard(picked.id); return }
        selected.current = { ...picked, target }
        setSelection(selected.current)
      }
    } catch (reason) { if (active.current) setError(errorText(reason)) }
    finally { if (active.current) setBusy(false) }
  }
  const cancel = (): void => {
    if (selected.current !== null) void bridge.discard(selected.current.id).catch(() => {})
    selected.current = null; setSelection(null); setError(null)
  }
  if (status !== null && !status.supported) return null
  return <section className={css.card} aria-label={t('icons.title')}>
    <h3>{t('icons.title')}</h3>
    {loadFailed && <p role="alert" className={css.error}>{t('icons.error.generic')}</p>}
    <p className={css.hint}>{t(status?.platform === 'darwin' ? 'icons.mac' : 'icons.description')}</p>
    {status !== null && <>
      <div className={css.iconRow}><img src={status.application} width="56" height="56" alt={t('icons.application')} />
        <span>{t('icons.application')}</span><div className={css.actions}>
          <Button disabled={busy} onClick={() => { void choose('application') }}>{t('icons.change')}</Button>
          <Button disabled={busy || (!status.applicationCustom && !status.damaged)} onClick={() => { void run(() => bridge.reset('application')) }}>{t('icons.reset')}</Button>
        </div></div>
      <div className={css.iconRow}><div className={css.trayPreview} data-background="transparency"><img src={status.tray} width="24" height="24" alt={t('icons.tray')} /></div><span>{t('icons.tray')}</span>
        <label className={css.follow}><input type="checkbox" checked={status.trayFollowsApplication} disabled={busy}
          onChange={(event) => { void run(() => bridge.followTray(event.target.checked)) }} />{t('icons.follow')}</label>
      </div>
      {!status.trayFollowsApplication && <div className={css.actions}>
        <Button disabled={busy} onClick={() => { void choose('tray') }}>{t('icons.changeTray')}</Button>
        <Button disabled={busy} onClick={() => { void run(() => bridge.reset('tray')) }}>{t('icons.reset')}</Button>
      </div>}
      {status.damaged && <p role="alert" className={css.error}>{t('icons.damaged')}</p>}
      <ul className={css.results} aria-live="polite">{status.results.map((result, index) => <li key={`${result.surface}-${index}`}>
        {t(`icons.surface.${result.surface}`)}{result.name === undefined ? '' : ` · ${result.name}`} — {t(`icons.status.${result.status}`)}
      </li>)}</ul>
      {status.canCreateShortcut && <div className={css.actions}>
        <Button disabled={busy} onClick={() => { void run(() => bridge.repairShortcuts()) }}>{t('icons.repair')}</Button>
        <Button disabled={busy} onClick={() => { void run(() => bridge.createShortcut()) }}>{t('icons.createShortcut')}</Button>
      </div>}
    </>}
    {error !== null && selection === null && <p role="alert" className={css.error}>{error}</p>}
    {selection !== null && <IconCropDialog key={selection.id} selection={selection} platform={status?.platform ?? ''} t={t} busy={busy} error={error} onCancel={cancel}
      onConfirm={(crop) => {
        void run(() => bridge.apply(selection.id, selection.target, crop)).then((success) => {
          if (success && active.current) { selected.current = null; setSelection(null) }
        })
      }} />}
  </section>
}
