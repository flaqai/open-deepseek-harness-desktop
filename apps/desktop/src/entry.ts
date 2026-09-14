/** Native package probe exits before importing the stateful desktop host. */
import { app } from 'electron'
import { lstat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

// Native package qualification must not acquire the installed user's instance lock or preferences.
const smokeRootArgument = process.argv.find(argument => argument.startsWith('--dsh-package-smoke-root='))
if (smokeRootArgument !== undefined) {
  const root = smokeRootArgument.slice('--dsh-package-smoke-root='.length)
  if (!isAbsolute(root) || dirname(resolve(root)) === resolve(root) || !(await lstat(root)).isDirectory()) {
    throw new Error('desktop: package smoke requires an existing absolute private data directory')
  }
  app.setPath('appData', root)
}

if (process.argv.includes('--dsh-native-smoke')) {
  const timeout = setTimeout(() => {
    app.exit(1)
  }, 10_000)
  void app.whenReady().then(() => {
    clearTimeout(timeout)
    console.log('DSH_NATIVE_SMOKE_READY')
    app.quit()
  }).catch((error: unknown) => {
    console.error(error)
    app.exit(1)
  })
} else {
  await import('./main.js')
}
