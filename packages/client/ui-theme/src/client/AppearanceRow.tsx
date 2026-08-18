/** Appearance settings: palette skins, original chat artwork, and a local custom background. */

import { useRef, useState, type ChangeEvent } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatBackgroundId } from '../chat-background.ts'
import type { ThemePreference } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createAppearanceRowStore } from './settings-store.ts'
import css from './AppearanceRow.module.css'

/** Business actions provided by the theme service. */
export interface AppearanceRowInjected {
  /** Switch the durable palette preference. */
  setTheme: (id: ThemePreference) => void
  /** Switch a shipped or previously uploaded browser-local background. */
  setBackground: (id: ChatBackgroundId) => void
  /** Prepare and persist a browser-local custom background. */
  setCustomBackground: (file: File) => Promise<void>
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type AppearanceRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createAppearanceRowStore>>
  & PropsLocale<'settings.theme'> & AppearanceRowInjected

const SKINS: readonly {
  id: ThemePreference
  labelKey: ThemeKey
  preview: string
  pairedBackground?: ChatBackgroundId
}[] = [
  { id: 'system', labelKey: 'appearance.system', preview: 'system' },
  { id: 'light', labelKey: 'appearance.light', preview: 'light' },
  { id: 'dark', labelKey: 'appearance.dark', preview: 'dark' },
  { id: 'ocean', labelKey: 'appearance.ocean', preview: 'ocean' },
  { id: 'moonlight', labelKey: 'appearance.moonlight', preview: 'moonlight' },
  { id: 'bubble', labelKey: 'appearance.bubble', preview: 'bubble' },
  {
    id: 'inspiration-collage', labelKey: 'appearance.inspirationCollage', preview: 'inspiration-collage',
    pairedBackground: 'idea-collage',
  },
  { id: 'starlight', labelKey: 'appearance.starlight', preview: 'starlight' },
  { id: 'pirate', labelKey: 'appearance.pirate', preview: 'pirate' },
  { id: 'shinobi', labelKey: 'appearance.shinobi', preview: 'shinobi' },
  { id: 'rift', labelKey: 'appearance.rift', preview: 'rift' },
]

const BACKGROUNDS: readonly {
  id: Exclude<ChatBackgroundId, 'custom'>
  labelKey: ThemeKey
  preview: string
  focus?: 'right'
}[] = [
  { id: 'none', labelKey: 'background.none', preview: 'none' },
  { id: 'deep-ocean', labelKey: 'background.deepOcean', preview: 'deep-ocean' },
  { id: 'moon-whale', labelKey: 'background.moonWhale', preview: 'moon-whale' },
  { id: 'bubble-whale', labelKey: 'background.bubbleWhale', preview: 'bubble-whale' },
  { id: 'idea-collage', labelKey: 'background.ideaCollage', preview: 'idea-collage', focus: 'right' },
  { id: 'anime-starlight', labelKey: 'background.animeStarlight', preview: 'anime-starlight', focus: 'right' },
  { id: 'pirate-horizon', labelKey: 'background.pirateHorizon', preview: 'pirate-horizon', focus: 'right' },
  { id: 'shinobi-ember', labelKey: 'background.shinobiEmber', preview: 'shinobi-ember', focus: 'right' },
  { id: 'rift-arena', labelKey: 'background.riftArena', preview: 'rift-arena', focus: 'right' },
]

/** Render the complete Appearance settings editor. */
export function AppearanceRow({ t, setTheme, setBackground, setCustomBackground, useStore }: AppearanceRowComponentProps) {
  const preference = useStore(state => state.preference)
  const background = useStore(state => state.background)
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<ThemeKey | undefined>()

  const upload = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    setUploading(true)
    setError(undefined)
    try {
      await setCustomBackground(file)
    } catch (cause) {
      const key = cause instanceof Error && cause.message.startsWith('background.')
        ? cause.message as ThemeKey
        : 'background.failed'
      setError(key)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className={css.group}>
      <section className={css.section} aria-labelledby="appearance-skins-title">
        <div className={css.headingRow}>
          <div>
            <div id="appearance-skins-title" className={css.title}>{t('appearance.skins')}</div>
            <div className={css.description}>{t('appearance.title')}</div>
          </div>
          <span className={css.badge}>{t('appearance.collection')}</span>
        </div>
        <div className={css.skinGrid}>
          {SKINS.map(({ id, labelKey, preview, pairedBackground }) => (
            <button key={id} type="button" className={clsx(css.choiceCard, preference === id && css.selected)}
              aria-pressed={preference === id} onClick={() => {
                setTheme(id)
                if (pairedBackground !== undefined) setBackground(pairedBackground)
              }}>
              <span className={css.skinPreview} data-preview={preview} aria-hidden="true">
                <span className={css.previewSidebar} />
                <span className={css.previewBubble} />
                <span className={css.previewComposer} />
              </span>
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={css.section} aria-labelledby="chat-background-title">
        <div>
          <div id="chat-background-title" className={css.title}>{t('background.title')}</div>
          <div className={css.description}>{t('background.description')}</div>
        </div>
        <div className={css.backgroundGrid}>
          {BACKGROUNDS.map(({ id, labelKey, preview, focus }) => (
            <button key={id} type="button" className={clsx(css.backgroundCard, background === id && css.selected)}
              aria-pressed={background === id} onClick={() => { setBackground(id) }}>
              <span className={css.backgroundPreview} data-background={preview} data-focus={focus} aria-hidden="true" />
              <span>{t(labelKey)}</span>
            </button>
          ))}
          {background === 'custom' && (
            <button type="button" className={clsx(css.backgroundCard, css.selected)} aria-pressed="true"
              onClick={() => { inputRef.current?.click() }}>
              <span className={css.customPreview} aria-hidden="true">✦</span>
              <span>{t('background.custom')}</span>
            </button>
          )}
        </div>
        <input ref={inputRef} className={css.fileInput} type="file" accept="image/png,image/jpeg,image/webp"
          onChange={(event) => { void upload(event) }} />
        <div className={css.uploadRow}>
          <button type="button" className={css.uploadButton} disabled={uploading}
            onClick={() => { inputRef.current?.click() }}>
            <span aria-hidden="true">＋</span>
            {t(background === 'custom' ? 'background.replace' : 'background.upload')}
          </button>
          {error !== undefined && <span className={css.error} role="alert">{t(error)}</span>}
        </div>
      </section>
    </div>
  )
}
