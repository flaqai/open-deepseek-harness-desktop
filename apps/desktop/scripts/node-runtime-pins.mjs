/** Official Node.js runtime archives embedded by the desktop packages. */

export const nodeVersion = '24.22.1'

export const nodeRuntimeArchivesByTarget = Object.freeze({
  'darwin-arm64': Object.freeze({
    name: `node-v${nodeVersion}-darwin-arm64.tar.gz`,
    sha256: '89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7',
  }),
  'darwin-x64': Object.freeze({
    name: `node-v${nodeVersion}-darwin-x64.tar.gz`,
    sha256: 'd132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035',
  }),
  'linux-x64': Object.freeze({
    name: `node-v${nodeVersion}-linux-x64.tar.gz`,
    sha256: 'eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c',
  }),
  'win32-x64': Object.freeze({
    name: `node-v${nodeVersion}-win-x64.zip`,
    sha256: 'd2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5',
  }),
})
