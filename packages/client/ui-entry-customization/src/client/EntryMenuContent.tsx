/** Folded Conversation Views and plugin discovery and creation actions. */
import {
  IconCheckOutlineRegular, IconPluginPinwheelOutlineRegular, IconPlusOutlineRegular, MenuItemButton,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './EntryMenu.module.css'

/** Navigation region whose More menu hosts one registration. */
export type EntryRegion = 'sidebar' | 'conversation' | 'rightbar'

/** Region identity and footer actions injected into each registration. */
export interface EntryMenuInjected {
  /** Region of this registration; selects analytics attributes and the Creator prompt. */
  readonly region: EntryRegion
  /** Open the Plugins main list. */
  readonly browsePlugins: () => void
  /** Start a Creator draft with this region's prompt without sending it. */
  readonly createPlugin: () => void
}

// The three region owners declare the same fields; the sidebar's slot names them.
type EntryMenuContentProps = PropsRuntime<'sidebar.panellist.actions'>
  & PropsLocale<'entryCustomization'> & InjectFace<EntryMenuInjected>

/**
 * Render folded Conversation Views followed by discovery and Creator actions, without pin controls.
 * @param props - Owner dismissal callback, injected actions, and localized copy.
 * @returns Menu rows for the region's More menu.
 */
export function EntryMenuContent({
  entries, onOpen, region, onDismiss, browsePlugins, createPlugin, t, useRemoteAccess,
}: EntryMenuContentProps) {
  const canCreate = useRemoteAccess('session/create')
  const moreEntries = region === 'conversation' ? entries : []
  return <>
    {moreEntries.map(entry => <MenuItemButton key={entry.id} current={entry.active === true}
      onSelect={() => { onDismiss(); onOpen(entry.id) }}>
      <span className={css.entryName}>
        <span className={css.entryTitle}>{entry.label}</span>
        {entry.active === true && <IconCheckOutlineRegular size={16} className={css.activeMark} />}
      </span>
    </MenuItemButton>)}
    <MenuItemButton separatorBefore={moreEntries.length > 0} icon={<IconPluginPinwheelOutlineRegular size={16} />}
      onSelect={() => { onDismiss(); browsePlugins() }}>
      {t('install')}
    </MenuItemButton>
    {canCreate && <MenuItemButton icon={<IconPlusOutlineRegular size={16} />} onSelect={() => { onDismiss(); createPlugin() }}>
      {t('create')}
    </MenuItemButton>}
  </>
}
