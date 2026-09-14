/** Copy the sealed payload without electron-builder's default node_modules exclusions. */
const { cp, lstat } = require('node:fs/promises')
const { join } = require('node:path')

module.exports = async function copyPrebuiltProfile(context) {
  if (context.electronPlatformName !== process.platform) throw new Error('Prebuilt resources require a native builder')
  const source = join(__dirname, '../../../.artifacts', `desktop-prebuilt-${process.platform}-${process.arch}`)
  const destination = join(context.packager.getResourcesDir(context.appOutDir), 'prebuilt-profile')
  if (!(await lstat(join(source, 'prebuilt-profile.json'))).isFile()) throw new Error('Missing prebuilt Profile manifest')
  await cp(source, destination, { recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true })
}
