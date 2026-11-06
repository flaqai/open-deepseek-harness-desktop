/** Application-styled editing menu driven by native local metadata. */
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { EditableMenuRequest } from './editable-menu.ts'
import type { EditableMenuSnapshot } from './editable-menu-projection.ts'
import type { EditableMenuKey } from './editable-menu-locales.ts'

/** Main-frame Desktop menu capability. */
export interface DesktopEditableMenuInjected {
  hooks: { editableMenu: HostObservable<EditableMenuSnapshot> }
  close(): void
  select(id: string): void
  returnFocus(): HTMLElement | null
}
/** Locale and capability supplied to the root overlay. */
export type DesktopEditableMenuProps = PropsRuntime<'shell.overlay'> & PropsLocale<'desktop-editable-menu'>
  & InjectFace<DesktopEditableMenuInjected>

/**
 * Build editing rows, an explicit spelling checkbox and optional native suggestions.
 * @param request Redacted native context for one field.
 * @param t Locale-owned menu labels.
 * @returns Shared Menu entries, without mutation handlers or field data.
 */
export function editableMenuEntries(request: EditableMenuRequest, t: (key: EditableMenuKey) => string): MenuEntry[] {
  const entries: MenuEntry[] = []
  if (request.misspelled) {
    entries.push(...request.suggestions.map((label, index) => ({ id: `replace:${index}`, label })))
    if (request.suggestions.length === 0) entries.push({ id: 'none', label: t('none'), disabled: true })
    entries.push({ id: 'add', label: t('add'), disabled: !request.allowed.includes('add') }, { id: 'spelling-end', type: 'separator' })
  }
  for (const command of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'] as const) {
    if (command === 'cut' || command === 'selectAll') entries.push({ id: `${command}-start`, type: 'separator' })
    entries.push({ id: command, label: t(command), disabled: !request.allowed.includes(command) })
  }
  if (request.spellingAllowed) entries.push({ id: 'toggle-start', type: 'separator' }, {
    id: 'toggle', label: t('toggle'), checked: request.spellingEnabled,
    disabled: !request.spellingAvailable,
  })
  if (request.spellingAllowed && !request.spellingAvailable) entries.push({ id: 'unavailable', label: t('unavailable'), disabled: true })
  return entries
}

/** Render one contextual menu without replacing editor contents or touching the clipboard. */
export function DesktopEditableMenu({ useEditableMenu, close, select, returnFocus, t }: DesktopEditableMenuProps) {
  const { request, failed } = useEditableMenu(value => value)
  return <>
    {request !== null ? <Menu contextual portal autoFocus preserveSelection open anchor={<span />}
      items={editableMenuEntries(request, t)} onSelect={select} onClose={close}
      getAnchorRect={() => new DOMRect(request.x, request.y, 0, 0)} returnFocus={returnFocus} /> : null}
    {failed ? <div role="alert">{t('failed')}</div> : null}
  </>
}
