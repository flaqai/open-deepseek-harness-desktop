import type { CustomInstructionVersion } from './types.ts'

/**
 * Render one saved revision with stable attribution for Session diagnostics.
 * @param scope - global or Workspace identity.
 * @param version - active immutable revision.
 * @returns model-visible text, or an empty contribution when disabled.
 */
export function renderCustomInstruction(
  scope: string,
  version: CustomInstructionVersion | undefined,
): string {
  if (version === undefined || version.text.trim().length === 0) return ''
  const scopeAttribute = scope === 'global' ? 'global' : `workspace:${scope}`
  return `<custom-instructions scope="${scopeAttribute}" version="${version.id}">\n${version.text}\n</custom-instructions>`
}
