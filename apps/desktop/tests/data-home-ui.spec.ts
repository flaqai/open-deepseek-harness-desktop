import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))

describe('desktop data-home chooser', () => {
  it('presents all three data strategies and the comparison dialog', async () => {
    const html = await readFile(`${desktopRoot}/src/data-home.html`, 'utf8')
    expect(html).toContain('data-mode="imported"')
    expect(html).toContain('data-mode="reused"')
    expect(html).toContain('data-mode="fresh"')
    expect(html).toContain('id="help"')
    expect(html).toContain('id="overlay"')
    expect(html).toContain('id="continue"')
  })

  it('keeps the chooser sandboxed and sends only bounded selections', async () => {
    const html = await readFile(`${desktopRoot}/src/data-home.html`, 'utf8')
    const preload = await readFile(`${desktopRoot}/src/data-home-preload.ts`, 'utf8')
    expect(html).toContain("default-src 'none'")
    expect(html).not.toContain('<script')
    expect(preload).toContain("type DataHomeMode = 'imported' | 'reused' | 'fresh'")
    expect(preload).toContain("ipcRenderer.send('dsh:data-home:selected', selected)")
    expect(preload).toContain("ipcRenderer.send('dsh:data-home:cancelled')")
  })
})
