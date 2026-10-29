/** Group management; ordering belongs to the navigation rail. */
import { useEffect, useRef, useState } from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsNavigationLayout } from '../types.ts'
import type { SettingsSectionRow, SettingsRootComponentProps } from './shell-contract.ts'
import { addLayoutGroup, removeLayoutGroup, renameLayoutGroup, setLayoutSectionHidden } from './section-layout.ts'
import css from './SettingsNavigationEditor.module.css'

/** Immediate navigation mutations persisted by the shell. */
export interface SettingsNavigationEditorProps {
  rows: readonly SettingsSectionRow[]
  layout: SettingsNavigationLayout
  t: SettingsRootComponentProps['t']
  onChange: (operation: (layout: SettingsNavigationLayout) => SettingsNavigationLayout) => void
  onClose: () => void
  selectedGroupId?: string
  selectedGroupAction?: 'rename' | 'delete'
}
/** Manage groups and recover hidden entries. */
export function SettingsNavigationEditor({
  rows, layout, t, onChange, onClose, selectedGroupId, selectedGroupAction,
}: SettingsNavigationEditorProps) {
  const [editing, setEditing] = useState<string>()
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState<string>()
  const selected = useRef<HTMLFieldSetElement>(null)
  useEffect(() => { selected.current?.scrollIntoView({ block: 'nearest' }) }, [selectedGroupId])
  useEffect(() => {
    const group = layout.groups.find(value => value.id === selectedGroupId)
    if (group === undefined || group.id === 'ungrouped') return
    if (selectedGroupAction === 'rename') { setEditing(group.id); setName(group.label) }
    if (selectedGroupAction === 'delete') setDeleting(group.id)
  }, [selectedGroupId, selectedGroupAction])
  const submitName = () => {
    const label = name.trim()
    if (!label || editing === undefined) return
    if (editing === 'new') onChange((current) => {
      let index = current.groups.length
      while (current.groups.some(group => group.id === `custom-${index}`)) index += 1
      return addLayoutGroup(current, `custom-${index}`, label)
    })
    else {
      const groupId = editing
      onChange(current => renameLayoutGroup(current, groupId, label))
    }
    setEditing(undefined)
  }
  return <section className={css.editor}>
    <header><h2>{t('nav.organizerTitle')}</h2><p>{t('nav.organizerHint')}</p></header>
    <Button variant="outline" onClick={() => { setEditing('new'); setName('') }}>{t('nav.addGroup')}</Button>
    {editing !== undefined ? <form className={css.group} onSubmit={(event) => { event.preventDefault(); submitName() }}>
      <label>{t('nav.groupName')}<input autoFocus maxLength={40} value={name} onChange={(event) => { setName(event.target.value) }} /></label>
      <div className={css.actions}><Button type="submit" disabled={!name.trim()}>{t('nav.save')}</Button><Button type="button" variant="outline" onClick={() => { setEditing(undefined) }}>{t('nav.cancel')}</Button></div>
    </form> : null}
    {layout.groups.map(group => <fieldset className={css.group} key={group.id} ref={group.id === selectedGroupId ? selected : undefined}>
      <legend>{group.id === 'ungrouped' ? t('nav.ungrouped') : group.label}</legend>
      <div className={css.visibilityRow}>
        <div className={css.visibilityText}>
          <div>{t('nav.showGroup')}</div>
          <p>{t('nav.showGroupHint')}</p>
        </div>
        <Switch checked={!group.hidden} label={t('nav.showGroup')} onChange={(visible) => {
          onChange(current => ({ ...current,
            groups: current.groups.map(value => value.id === group.id ? { ...value, hidden: !visible } : value),
          }))
        }} />
      </div>
      {group.id !== 'ungrouped' ? <div className={css.actions}>
        <Button variant="outline" onClick={() => { setEditing(group.id); setName(group.label) }}>{t('nav.renameGroup')}</Button>
        <Button variant="outline" onClick={() => { setDeleting(group.id) }}>{t('nav.deleteGroup')}</Button>
      </div> : null}
      {deleting === group.id ? <div role="alert" className={css.confirm}>
        <p>{t('nav.deleteGroupHint')}</p><div className={css.actions}>
          <Button onClick={() => { onChange(current => removeLayoutGroup(current, group.id)); setDeleting(undefined) }}>{t('nav.confirmDelete')}</Button>
          <Button variant="outline" onClick={() => { setDeleting(undefined) }}>{t('nav.cancel')}</Button></div>
      </div> : null}
    </fieldset>)}
    <section className={css.group}><h3>{t('nav.hiddenEntries')}</h3>
      {rows.filter(row => layout.hiddenIds.includes(row.id)).map(row => <div className={css.entry} key={row.id}><span>{row.label}</span>
        <Button variant="outline" onClick={() => { onChange(current => setLayoutSectionHidden(current, row.id, false)) }}>{t('nav.restoreEntry')}</Button></div>)}
      {!rows.some(row => layout.hiddenIds.includes(row.id)) ? <p>{t('nav.noHiddenEntries')}</p> : null}
    </section>
    <footer><Button variant="outline" onClick={onClose}>{t('nav.done')}</Button></footer>
  </section>
}
