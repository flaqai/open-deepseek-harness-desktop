/** Bounded startup diagnostics that retain causes before dependency fallout. */

/**
 * Prefer the actual failed-plugin block; keep the beginning and end for other errors.
 * @param text Complete diagnostic output.
 * @param limit Maximum summary length in characters.
 * @returns A bounded summary suitable for presentation as plain text.
 */
export function summarizeFailure(text: string, limit = 1200): string {
  const failed = text.lastIndexOf('Failed plugins (')
  const pending = text.indexOf('Plugins waiting for services (', Math.max(0, failed))
  const selected = failed >= 0 ? text.slice(failed, pending < 0 ? undefined : pending).trim() : text.trim()
  if (selected.length <= limit) return selected
  const head = Math.floor((limit - 5) * 0.75)
  return `${selected.slice(0, head)}\n…\n${selected.slice(-(limit - head - 5))}`
}
