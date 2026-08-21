/** Run serial browser owners before one bounded snapshot pool. */
import { spawn } from 'node:child_process'

const serialFiles = [
  'apps/web/tests/hmr-live.e2e.ts',
  'apps/web/tests/cordis-tool-round.e2e.ts',
]
const workerRaw = process.env.DSH_WEB_SNAPSHOT_WORKERS
const workers = Number.parseInt(workerRaw ?? '', 10)
if (!Number.isSafeInteger(workers) || workers < 2 || String(workers) !== workerRaw) {
  throw new Error(`DSH_WEB_SNAPSHOT_WORKERS must be an integer greater than 1, got ${JSON.stringify(workerRaw)}.`)
}
const pnpmEntrypoint = process.env.npm_execpath
if (pnpmEntrypoint === undefined || pnpmEntrypoint === '') {
  throw new Error('parallel web snapshots must be invoked through a pnpm package script.')
}

const baseArgs = [pnpmEntrypoint, 'exec', 'vitest', 'run', '--config', 'vitest.web.config.ts']
let serialStatus = 0
for (const file of serialFiles) {
  serialStatus = await run([...baseArgs, file])
  if (serialStatus !== 0) break
}
if (serialStatus === 0) {
  process.exitCode = await run([
    ...baseArgs,
    ...serialFiles.map(file => `--exclude=${file}`),
    '--fileParallelism',
    `--maxWorkers=${String(workers)}`,
  ])
} else {
  process.exitCode = serialStatus
}

function run(args: string[]): Promise<number> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (exitCode, signalCode) => {
      if (signalCode !== null) {
        console.error(`web snapshots terminated by ${signalCode}`)
        resolveRun(1)
        return
      }
      resolveRun(exitCode ?? 1)
    })
  })
}
