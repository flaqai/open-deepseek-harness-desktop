/** Isolated packaged Electron probes with bounded diagnostics and awaited teardown. */
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUTPUT_BYTES = 1024 * 1024
const CLEANUP_TIMEOUT_MS = 5000

function terminateOwnedChild(child, hasExited, env) {
  if (hasExited()) return Promise.resolve()
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return Promise.reject(new Error('Electron probe has no owned process id'))
  if (process.platform !== 'win32') {
    // The probe alone was spawned detached, so this id names its own process group.
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) {
      if (error.code !== 'ESRCH') return Promise.reject(error)
    }
    return Promise.resolve()
  }
  const command = join(process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows', 'System32', 'taskkill.exe')
  return new Promise((resolvePromise, reject) => {
    execFile(command, ['/PID', String(child.pid), '/T', '/F'], {
      env, windowsHide: true, timeout: CLEANUP_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: OUTPUT_BYTES,
    }, (error) => { if (error) reject(error); else resolvePromise() })
  })
}

function capture() {
  const chunks = []
  let bytes = 0
  let truncated = false
  return {
    append(text) {
      const chunk = Buffer.from(text)
      const retained = chunk.subarray(0, OUTPUT_BYTES - bytes)
      if (retained.length > 0) chunks.push(retained)
      bytes += retained.length
      truncated ||= retained.length < chunk.length
    },
    result() { return { text: Buffer.concat(chunks).toString('utf8'), truncated } },
  }
}

function markerLines(marker) {
  let line = ''
  let oversized = false
  let found = false
  const finishLine = () => {
    if (!oversized && (line === marker || line === `${marker}\r`)) found = true
    line = ''
    oversized = false
  }
  return {
    append(text) {
      const segments = text.split('\n')
      for (const [index, segment] of segments.entries()) {
        if (!oversized) {
          oversized = line.length + segment.length > marker.length + 1
          if (!oversized) line += segment
        }
        if (index < segments.length - 1) finishLine()
      }
    },
    finish() { finishLine(); return found },
  }
}

async function readEntryLog(root) {
  let file
  try {
    file = await open(join(root, 'desktop-entry.log'), 'r')
    const buffer = Buffer.alloc(OUTPUT_BYTES)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    const { size } = await file.stat()
    return { text: buffer.subarray(0, bytesRead).toString('utf8'), truncated: size > bytesRead }
  } catch (error) {
    if (error.code === 'ENOENT') return { text: '', truncated: false }
    throw error
  } finally {
    await file?.close()
  }
}

/**
 * Run one Electron probe in a private data root, then remove it after confirmed cleanup.
 * A readiness marker must occupy a complete stdout line; timeout, signal, and exit
 * status remain independent facts even when shutdown exits successfully.
 * @param {{ executable: string, args: string[], marker: string, timeoutMs: number }} options Probe command and acceptance criteria.
 * @returns {Promise<object>} Successful outcome and bounded stdout, stderr, and entry log. Failures attach the same outcome as `error.result`.
 */
export async function runElectronPackageProbe({ executable, args, marker, timeoutMs }) {
  if (!marker || /[\r\n]/u.test(marker)) throw new Error('Electron probe marker must be one non-empty line')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Electron probe timeout must be a positive integer')
  const root = await mkdtemp(join(tmpdir(), 'odsh-electron-package-probe-'))
  let removable = true
  let primaryError
  let result
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      !/KEY|SECRET|TOKEN|PASSWORD/iu.test(name) && !['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(name.toUpperCase())))
    env.ELECTRON_ENABLE_LOGGING = '1'
    const stdout = capture()
    const stderr = capture()
    const lines = markerLines(marker)
    const outcome = await new Promise((resolvePromise, reject) => {
      let child
      try {
        child = spawn(executable, [...args, `--dsh-package-smoke-root=${root}`], {
          env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        reject(error)
        return
      }
      let timedOut = false
      let startError
      let cleanupError
      let exited = false
      let closed = false
      let terminating = false
      let closeTimeout
      let exitCode = null
      let signal = null
      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        clearTimeout(closeTimeout)
        resolvePromise({ exitCode, signal, timedOut, startError, cleanupError, closed })
      }
      const finish = () => {
        if (!closed || terminating) return
        settle()
      }
      const boundCloseWait = () => {
        if (settled) return
        closeTimeout ??= setTimeout(() => {
          cleanupError ??= new Error('Electron probe cleanup failed: child close was not observed')
          settle()
        }, CLEANUP_TIMEOUT_MS + 1000)
      }
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', text => { stdout.append(text); lines.append(text) })
      child.stderr.on('data', text => { stderr.append(text) })
      const timeout = setTimeout(() => {
        timedOut = true
        terminating = true
        boundCloseWait()
        void terminateOwnedChild(child, () => exited || settled, env).catch(error => {
          cleanupError = error
          // Preserve the tree-cleanup failure even if terminating the direct child succeeds.
          if (!exited && !settled) child.kill('SIGKILL')
        }).finally(() => { terminating = false; finish() })
      }, timeoutMs)
      child.once('error', error => { startError = error })
      child.once('exit', (code, exitSignal) => {
        exited = true
        exitCode = code
        signal = exitSignal
        clearTimeout(timeout)
        boundCloseWait()
      })
      child.once('close', (code, exitSignal) => {
        closed = true
        exitCode = code
        signal = exitSignal
        clearTimeout(timeout)
        finish()
      })
    })
    const out = stdout.result()
    const err = stderr.result()
    removable = outcome.closed && outcome.cleanupError === undefined
    let entry = { text: '', truncated: false }
    let entryLogError
    try { entry = await readEntryLog(root) } catch (error) { entryLogError = error }
    result = {
      root, ...outcome, markerSeen: lines.finish(),
      stdout: out.text, stdoutTruncated: out.truncated,
      stderr: err.text, stderrTruncated: err.truncated,
      entryLog: entry.text, entryLogTruncated: entry.truncated,
      entryLogError, rootPreserved: !removable,
    }
    if (result.startError || result.cleanupError || result.entryLogError || result.timedOut || result.exitCode !== 0 || result.signal !== null || !result.markerSeen) {
      const error = new Error(`Electron probe ${args.join(' ')} failed: exitCode=${result.exitCode}, signal=${result.signal}, timedOut=${result.timedOut}, markerSeen=${result.markerSeen}, closed=${result.closed}, rootPreserved=${result.rootPreserved}, root=${root}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\nentry:\n${result.entryLog}`, { cause: result.startError ?? result.cleanupError ?? result.entryLogError })
      error.result = result
      throw error
    }
    return result
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (removable) {
      try { await rm(root, { recursive: true, force: true }) } catch (error) {
        if (result) {
          result.rootPreserved = true
          result.rootCleanupError = error
        }
        if (primaryError) primaryError.rootCleanupError = error
        else {
          const cleanupFailure = new Error(`Electron probe could not remove its private root: ${root}`, { cause: error })
          cleanupFailure.result = result
          throw cleanupFailure
        }
      }
    }
  }
}
