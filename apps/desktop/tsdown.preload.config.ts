import { defineConfig } from 'tsdown'

/**
 * Electron's sandboxed preload loader expects CommonJS. Bundle the preload's
 * local helpers while leaving Electron's built-in bridge as a runtime require.
 */
export default defineConfig({
  entry: ['lib/preload.js', 'lib/data-home-preload.js'],
  outDir: 'lib',
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  fixedExtension: true,
  dts: false,
  clean: false,
  deps: { neverBundle: ['electron'] },
})
