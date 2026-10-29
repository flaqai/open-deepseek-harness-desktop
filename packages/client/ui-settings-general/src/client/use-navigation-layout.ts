import { useEffect, useRef, useState } from 'react'
import type { SettingsNavigationLayout } from '../types.ts'

type Operation = (layout: SettingsNavigationLayout) => SettingsNavigationLayout

/** Own optimistic navigation edits and persist them serially, reverting failed dependent edits.
 * @param source Accepted Profile layout.
 * @param save Persist one complete layout.
 * @returns Current projection, mutation entry, and save status.
 */
export function useNavigationLayout(source: SettingsNavigationLayout, save: (layout: SettingsNavigationLayout) => Promise<void>): {
  layout: SettingsNavigationLayout
  mutate: (operation: Operation) => void
  saving: boolean
  failed: boolean
} {
  const [layout, setLayout] = useState(source)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const state = useRef({ confirmed: source, current: source, queue: [] as SettingsNavigationLayout[], running: false, mounted: true })
  const saveRef = useRef(save)
  saveRef.current = save
  const sourceKey = JSON.stringify(source)
  useEffect(() => {
    state.current.mounted = true
    return () => { state.current.mounted = false; state.current.queue = [] }
  }, [])
  useEffect(() => {
    const owner = state.current
    if (owner.running) return
    owner.confirmed = source
    owner.current = source
    setLayout(source)
  }, [sourceKey])
  const mutate = (operation: Operation) => {
    const owner = state.current
    const next = operation(owner.current)
    if (next === owner.current) return
    owner.current = next
    owner.queue.push(next)
    setLayout(next)
    setFailed(false)
    if (owner.running) return
    owner.running = true
    setSaving(true)
    void (async () => {
      try {
        while (owner.queue.length > 0) {
          const pending = owner.queue.shift()
          if (pending === undefined) break
          await saveRef.current(pending)
          owner.confirmed = pending
        }
      } catch {
        owner.queue = []
        owner.current = owner.confirmed
        if (owner.mounted) { setLayout(owner.confirmed); setFailed(true) }
      } finally {
        owner.running = false
        if (owner.mounted) setSaving(false)
      }
    })()
  }
  return { layout, mutate, saving, failed }
}
