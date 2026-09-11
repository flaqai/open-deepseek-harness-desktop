/** Official Node.js runtime archives embedded by the desktop packages. */

export const nodeVersion = '24.17.0'

export const nodeRuntimeArchivesByTarget = Object.freeze({
  'darwin-arm64': Object.freeze({
    name: `node-v${nodeVersion}-darwin-arm64.tar.gz`,
    sha256: '4fc3266a3702eebc39cc37661cf4eeceeade307e242ab64e4d7ce7949197e11f',
  }),
  'darwin-x64': Object.freeze({
    name: `node-v${nodeVersion}-darwin-x64.tar.gz`,
    sha256: '80da552fe037290cb130e9dea590f5eeeb7aa450636f0c89ab41415511c1ec27',
  }),
  'linux-x64': Object.freeze({
    name: `node-v${nodeVersion}-linux-x64.tar.gz`,
    sha256: 'e0472427aa791ad80bdc426ff7cc73cdd28ed0f616d1ff9689a23a7f47f1265f',
  }),
  'win32-x64': Object.freeze({
    name: `node-v${nodeVersion}-win-x64.zip`,
    sha256: 'f2aa33b35b75aca5f3f7b85675a6f6423201053e9381911e64961f3bda2528ab',
  }),
})
