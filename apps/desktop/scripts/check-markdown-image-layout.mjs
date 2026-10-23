/** Native Chromium geometry regression for Markdown images under text trimming. */
import { app, BrowserWindow } from 'electron'
import { readFile, rm } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const data = mkdtempSync(join(tmpdir(), 'odsh-markdown-layout-'))
app.setPath('userData', data)
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
const deadline = setTimeout(() => {
  console.error('Markdown layout probe timed out')
  void rm(data, { recursive: true, force: true }).finally(() => { app.exit(2) })
}, 30000)
async function main() {
  let window
  let code = 1
  try {
    await app.whenReady()
    const css = await readFile(join(root, 'packages/client/ui-primitives/src/markdown/MarkdownText.module.css'), 'utf8')
    window = new BrowserWindow({ show: false, width: 1444, height: 1123, webPreferences: { backgroundThrottling: false } })
    // Same typography rule as the smooth-stream 0.6.1 archive. Keep
    // it active: media containers, not the plugin or all prose, own this fix.
    await window.loadURL('data:text/html,' + encodeURIComponent(`<style>
    body { margin: 16px; font: 16px/24px sans-serif; }
    .smooth :is(p,h1,h2,h3,h4,h5,h6,blockquote) { text-box-trim: trim-both; text-box-edge: text; }
    ${css}
  </style><main class="smooth"><section class="markdown"></section></main>`))
    const result = await window.webContents.executeJavaScript(`(async () => {
    if (!CSS.supports('text-box-trim', 'trim-both')) throw new Error('Chromium lacks text-box-trim; cannot verify regression');
    const section = document.querySelector('section');
    const results = [];
    const wraps = {
      plain: image => '<p>' + image + '</p>',
      lightbox: image => '<p><button class="imageButton">' + image + '</button></p>',
      link: image => '<p><a href="https://example.invalid/">' + image + '</a></p>',
      mixed: image => '<p>Before ' + image + ' after</p>',
      mixedLightbox: image => '<p>Before <button class="imageButton">' + image + '</button> after</p>',
      list: image => '<ul><li><p>' + image + '</p></li></ul>',
      quote: image => '<blockquote><p>' + image + '</p></blockquote>',
      listLightbox: image => '<ul><li><p><button class="imageButton">' + image + '</button></p></li></ul>',
      quoteLightbox: image => '<blockquote><p><button class="imageButton">' + image + '</button></p></blockquote>',
      heading: image => '<h3>' + image + '</h3>',
      multiple: image => '<p><button class="imageButton">' + image + '</button> <button class="imageButton">' + image + '</button></p>',
      consecutive: image => '<p><button class="imageButton">' + image + '</button></p><p><button class="imageButton">' + image + '</button></p>',
    };
    for (const width of [320, 390, 680, 681, 1000]) {
      section.style.width = width + 'px';
      for (const [name, wrap] of Object.entries(wraps)) {
        for (const [w, h] of [[1200,800], [500,1500], [1600,200]]) {
          section.innerHTML = '<h2 id="before">Previous text</h2>' + wrap('<img class="image" alt="synthetic image">')
            + '<h2 id="after">Following text</h2><p id="prose">Ordinary prose</p>';
          section.getBoundingClientRect();
          const img = section.querySelector('img');
          img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><rect width="100%" height="100%" fill="steelblue"/></svg>');
          for (const other of section.querySelectorAll('img')) other.src = img.src;
          await Promise.all([...section.querySelectorAll('img')].map(image => image.decode()));
          const images = [...section.querySelectorAll('img')].map(image => image.getBoundingClientRect());
          const before = section.querySelector('#before').getBoundingClientRect();
          const after = section.querySelector('#after').getBoundingClientRect();
          const container = section.getBoundingClientRect();
          const separate = images.every((image, index) => images.slice(index + 1).every(other =>
            Math.min(image.right,other.right) - Math.max(image.left,other.left) <= 1
            || Math.min(image.bottom,other.bottom) - Math.max(image.top,other.top) <= 1));
          const pass = images.every(image => image.height > 0 && image.top >= before.bottom - 1 && image.bottom <= after.top + 1
            && image.left >= container.left - 1 && image.right <= container.right + 1
            && Math.abs(image.width / image.height - w / h) < 0.01) && separate
            && getComputedStyle(section.querySelector('#prose')).textBoxTrim === 'trim-both';
          results.push({ width, name, size: [w,h], pass, images: images.map(image => [image.top,image.bottom]), followingTop: after.top });
        }
      }
    }
    return { cases: results.length, failures: results.filter(result => !result.pass) };
  })()`)
    console.log(JSON.stringify(result))
    code = result.failures.length === 0 ? 0 : 1
  } catch (error) {
    console.error(error)
  } finally {
    clearTimeout(deadline)
    window?.destroy()
    await rm(data, { recursive: true, force: true })
    app.exit(code)
  }
}
void main()
