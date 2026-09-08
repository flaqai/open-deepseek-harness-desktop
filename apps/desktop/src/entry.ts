/** Native package probe exits before importing the stateful desktop host. */
import { app } from 'electron'

if (process.argv.includes('--dsh-native-smoke')) {
  const timeout = setTimeout(() => app.exit(1), 10_000)
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
