import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

describe('PDF.js mobile compatibility', () => {
  it.each([
    'pdfjs-dist/legacy/build/pdf.mjs',
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
  ])('loads %s when the Iterator global is unavailable', (specifier) => {
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `delete globalThis.Iterator; await import(${JSON.stringify(specifier)});`,
    ], { cwd: packageRoot, encoding: 'utf8' })

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })
})
