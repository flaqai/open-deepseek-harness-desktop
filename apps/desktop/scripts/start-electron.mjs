/** Start the project-owned development app and forward process termination. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { developmentElectron } from './development-electron.mjs'
const child = spawn(developmentElectron(), [fileURLToPath(new URL('../', import.meta.url)), ...process.argv.slice(2)], {
  stdio: 'inherit', env: process.env,
})
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { child.kill(signal) })
child.on('error', error => { console.error(error); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === null ? 1 : 130) })
