/** Preserve only the native editable target and selection while an application menu owns focus. */
interface TargetSnapshot {
  element: HTMLElement
  range: Range | null
  value: string | null
  start: number | null
  end: number | null
  direction: 'forward' | 'backward' | 'none' | null
  invalid: boolean
}
const menuSelector = '[data-context-menu], [data-desktop-edit-menu]'
function editable(element: Element | null): HTMLElement | null {
  const target = element?.closest<HTMLElement>('input, textarea, [contenteditable]')
  if (!target) return null
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
    && target.getAttribute('contenteditable') === 'false') return null
  if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && (target.disabled || target.readOnly)) return null
  return target
}
/**
 * Track DOM target identity without exposing input text to the renderer bridge.
 * @param document Trusted main-frame DOM.
 * @returns Context binding, focus restoration and disposal operations.
 */
export function createEditableMenuTarget(document: Document): {
  bind(token: string): boolean
  restore(token: string): boolean
  dismiss(token: string): void
  dispose(): void
} {
  let captured: TargetSnapshot | undefined
  let token: string | undefined
  let capturedAt = 0
  let observer: MutationObserver | undefined
  const clear = (): void => { captured = undefined; token = undefined; observer?.disconnect() }
  const context = (event: MouseEvent): void => {
    const element = event.target instanceof Element ? editable(event.target) : null
    if (element === null) { if (!(event.target instanceof Element && event.target.closest(menuSelector))) clear(); return }
    clear()
    const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null
    const selection = document.getSelection()
    const range = input === null && selection?.rangeCount === 1 ? selection.getRangeAt(0).cloneRange() : null
    captured = { element, start: input?.selectionStart ?? null, end: input?.selectionEnd ?? null,
      direction: input?.selectionDirection ?? null, range, value: input?.value ?? null, invalid: false }
    capturedAt = Date.now()
    observer = new MutationObserver(() => { if (captured !== undefined) captured.invalid = true })
    observer.observe(element, { childList: true, subtree: true, characterData: true })
  }
  const invalidate = (event: Event): void => {
    if (captured === undefined) return
    const target = event.target instanceof Element ? event.target : null
    if (event.type === 'input' || target === null
      || (event.type === 'pointerdown' && !target.closest(menuSelector))
      || (!captured.element.contains(target) && !target.closest(menuSelector))) captured.invalid = true
  }
  document.addEventListener('contextmenu', context, true)
  document.addEventListener('input', invalidate, true)
  document.addEventListener('pointerdown', invalidate, true)
  document.addEventListener('focusin', invalidate, true)
  const valid = (expected: string): TargetSnapshot | undefined => {
    const snapshot = captured
    if (snapshot !== undefined) {
      if ((observer?.takeRecords().length ?? 0) > 0) snapshot.invalid = true
      // Property assignments do not emit input or DOM mutation events. Keep this
      // value only inside preload; neither bridge metadata nor commands carry it.
      if ((snapshot.element instanceof HTMLInputElement || snapshot.element instanceof HTMLTextAreaElement)
        && snapshot.element.value !== snapshot.value) snapshot.invalid = true
    }
    return token === expected && snapshot !== undefined && !snapshot.invalid && snapshot.element.isConnected
      && editable(snapshot.element) === snapshot.element ? snapshot : undefined
  }
  return {
    bind(value) {
      if (captured === undefined || captured.invalid || Date.now() - capturedAt > 1500) return false
      token = value
      const snapshot = valid(value)
      if (snapshot === undefined) { token = undefined; return false }
      // Chromium can select the misspelled word after the DOM contextmenu event.
      // Bind to that native selection before the application menu takes focus.
      if (snapshot.element instanceof HTMLInputElement || snapshot.element instanceof HTMLTextAreaElement) {
        snapshot.start = snapshot.element.selectionStart
        snapshot.end = snapshot.element.selectionEnd
        snapshot.direction = snapshot.element.selectionDirection
      } else {
        const selection = document.getSelection()
        const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null
        snapshot.range = range !== null && snapshot.element.contains(range.startContainer)
          && snapshot.element.contains(range.endContainer) ? range.cloneRange() : null
      }
      return true
    },
    restore(value) {
      const snapshot = valid(value)
      if (snapshot === undefined) return false
      snapshot.element.focus({ preventScroll: true })
      if (snapshot.start !== null && snapshot.end !== null
        && (snapshot.element instanceof HTMLInputElement || snapshot.element instanceof HTMLTextAreaElement)) {
        snapshot.element.setSelectionRange(snapshot.start, snapshot.end, snapshot.direction ?? undefined)
      } else if (snapshot.range !== null) {
        if (!snapshot.element.contains(snapshot.range.startContainer)
          || !snapshot.element.contains(snapshot.range.endContainer)) return false
        const selection = document.getSelection()
        selection?.removeAllRanges(); selection?.addRange(snapshot.range)
      }
      return true
    },
    dismiss(value) { if (token === value) clear() },
    dispose() {
      clear()
      document.removeEventListener('contextmenu', context, true)
      document.removeEventListener('input', invalidate, true)
      document.removeEventListener('pointerdown', invalidate, true)
      document.removeEventListener('focusin', invalidate, true)
    },
  }
}
