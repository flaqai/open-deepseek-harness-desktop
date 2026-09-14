/** Ad-hoc sign the completed macOS bundle without opening every resource in Node. */
const { execFile } = require('node:child_process')
const { lstat } = require('node:fs/promises')
const { isAbsolute } = require('node:path')
const { promisify } = require('node:util')

const run = promisify(execFile)

function createCodesignArgs(app) {
  if (typeof app !== 'string' || !isAbsolute(app) || !app.endsWith('.app')) {
    throw new Error('macOS signing requires an absolute .app bundle path')
  }
  return ['--force', '--deep', '--sign', '-', '--timestamp=none', app]
}

async function sign(options) {
  const args = createCodesignArgs(options?.app)
  if (!(await lstat(options.app)).isDirectory()) throw new Error('macOS signing target is not an application bundle')
  await run('/usr/bin/codesign', args, { maxBuffer: 4 * 1024 * 1024 })
}

module.exports = sign
module.exports.sign = sign
module.exports.createCodesignArgs = createCodesignArgs
