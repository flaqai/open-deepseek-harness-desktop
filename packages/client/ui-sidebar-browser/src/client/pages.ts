/** Assemble iframe navigation and presentation without platform branches in consumers. */
import type { BrowserPage, BrowserPageOptions } from './browser/BrowserPage.ts'
import { IframeImpl } from './browser/IframeImpl.ts'
import { IframePresentation } from './view/IframePresentation.ts'

/**
 * Assemble an idle iframe provider and its DOM presentation.
 * @param options - saved navigation and callbacks.
 * @param policy - Desktop fixes the sandbox; Web keeps the temporary toggle.
 * @returns the selected iframe page's navigation and presentation objects.
 */
export function createIframePage(options: BrowserPageOptions, policy: 'web' | 'desktop' = 'web'): BrowserPage {
  const presentation = new IframePresentation({
    loaded: (revision) => { frame.handleLoaded(revision) },
    failed: (revision) => { frame.handleLoadFailed(revision) },
    remounted: () => { frame.reload() },
  }, policy)
  const frame = new IframeImpl(options, presentation, policy)
  return { frame, presentation }
}
