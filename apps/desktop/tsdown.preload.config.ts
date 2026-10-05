import type { UserConfig } from 'tsdown'
import { defineConfig } from 'tsdown'

const shared: UserConfig = {
  outDir: 'lib',
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  fixedExtension: true,
  dts: false,
  clean: false,
  // Electron's sandboxed preload loader cannot require sibling bundle chunks.
  // Keep every preload self-contained even when entries share local helpers.
  outputOptions: { codeSplitting: false },
  deps: { neverBundle: ['electron'] },
}

/**
 * Electron's sandboxed preload loader expects CommonJS. Bundle the preload's
 * local helpers while leaving Electron's built-in bridge as a runtime require.
 */
export default defineConfig([
  { ...shared, entry: ['lib/preload.js'] },
  { ...shared, entry: ['lib/data-home-preload.js'] },
  { ...shared, entry: ['lib/titlebar-preload.js'] },
  { ...shared, entry: ['lib/preload-welcome.js'] },
])
