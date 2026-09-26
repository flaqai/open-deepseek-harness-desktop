import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

await build({
  configFile: false,
  root: fileURLToPath(new URL('../', import.meta.url)),
  esbuild: { jsx: 'automatic' },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [{
    name: 'desktop-welcome-brand-font',
    async generateBundle() {
      for (const name of ['brand-font.css', 'montserrat-regular.woff2', 'montserrat-light.woff2', 'montserrat-medium.woff2', 'Montserrat-OFL.txt']) {
        this.emitFile({
          type: 'asset',
          fileName: name,
          source: await readFile(new URL(`../../../packages/client/ui-theme/src/styles/${name}`, import.meta.url)),
        })
      }
    },
  }],
  build: {
    outDir: 'lib/welcome',
    emptyOutDir: true,
    lib: {
      entry: 'src/client/welcome.tsx',
      formats: ['iife'],
      name: 'DesktopWelcome',
      fileName: () => 'welcome.js',
      cssFileName: 'welcome',
    },
  },
})
