#!/usr/bin/env node
/** Rebuild and restart the Electron shell after desktop source changes. */

import { spawn } from 'node:child_process'
import { statSync, watch } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..')
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const ELECTRON = process.platform === 'win32' ? 'electron.cmd' : 'electron'
const WATCH_TARGETS = ['src', 'package.json', 'tsconfig.json', 'tsdown.preload.config.ts']

let electron
let build
let timer
let closing = false
let rebuildQueued = false
let restarting = false

function startElectron() {
  electron = spawn(ELECTRON, ['lib/main.js'], { cwd: APP_DIRECTORY, stdio: 'inherit', env: process.env })
  electron.once('exit', () => {
    electron = undefined
    if (restarting) {
      restarting = false
      return
    }
    if (!closing) shutdown()
  })
}

function stopElectron() {
  return new Promise((resolve) => {
    if (electron === undefined) { resolve(); return }
    const child = electron
    child.once('exit', resolve)
    child.kill('SIGTERM')
    setTimeout(() => { if (electron === child) child.kill('SIGKILL') }, 5_000).unref()
  })
}

function runBuild() {
  if (closing || build !== undefined) { rebuildQueued = true; return }
  build = spawn(PNPM, ['run', 'build'], { cwd: APP_DIRECTORY, stdio: 'inherit', env: process.env })
  build.once('exit', (code) => {
    build = undefined
    if (closing) return
    if (code === 0) {
      restarting = electron !== undefined
      void stopElectron().then(startElectron)
    }
    if (rebuildQueued) {
      rebuildQueued = false
      runBuild()
    }
  })
}

function scheduleBuild() {
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(() => { timer = undefined; runBuild() }, 250)
}

const watchers = WATCH_TARGETS.map((target) => {
  const path = join(APP_DIRECTORY, target)
  return watch(path, statSync(path).isDirectory() ? { recursive: true } : {}, scheduleBuild)
})

function shutdown() {
  if (closing) return
  closing = true
  if (timer !== undefined) clearTimeout(timer)
  for (const watcher of watchers) watcher.close()
  build?.kill('SIGTERM')
  void stopElectron().finally(() => { process.exit(0) })
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown)
runBuild()
