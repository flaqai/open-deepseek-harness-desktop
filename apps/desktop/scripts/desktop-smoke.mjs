/** Fixed Desktop qualification commands; this entry never builds or installs dependencies. */
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../..')
const TARGETS = {
  'windows-x64': ['win32', 'x64'],
  'macos-arm64': ['darwin', 'arm64'],
  'macos-x64': ['darwin', 'x64'],
  'linux-x64': ['linux', 'x64'],
}
const STAGES = ['contracts', 'unpacked', 'package']
const SCRIPT_DIRECTORY = 'apps/desktop/scripts'

/** Parse the closed CLI, with no forwarded arguments or platform aliases. */
export function parseSmokeArguments(args) {
  if (args.length < 2 || args.length > 3 || (args.length === 3 && args[2] !== '--plan')) {
    throw new Error('usage: desktop-smoke.mjs <contracts|unpacked|package> <windows-x64|macos-arm64|macos-x64|linux-x64> [--plan]')
  }
  const [stage, target] = args
  if (!STAGES.includes(stage) || !Object.hasOwn(TARGETS, target)) throw new Error('desktop smoke: unsupported stage or target')
  if (stage === 'unpacked' && target !== 'windows-x64') throw new Error('desktop smoke: unpacked is supported only for windows-x64')
  return { stage, target, plan: args.length === 3 }
}

/** Derive only the repository-owned command paths and acceptance scope. */
export function createSmokePlan(request, repositoryRoot = REPOSITORY_ROOT, node = process.execPath) {
  const { stage, target } = parseSmokeArguments([request.stage, request.target])
  const script = name => join(repositoryRoot, SCRIPT_DIRECTORY, name)
  const step = (id, command, args, timeoutMs = 120_000) => ({ id, command, args, timeoutMs })
  const nodeStep = (id, name, args = [], timeoutMs) => step(id, node, [script(name), ...args], timeoutMs)
  let scope = stage === 'contracts' ? 'contracts' : 'native-package'
  let steps
  if (stage === 'contracts') {
    const shared = ['electron-package-probe.test.mjs', 'desktop-smoke.test.mjs']
    const tests = target === 'windows-x64'
      ? ['runtime-deploy-config.test.mjs', 'collect-windows-smoke-evidence.test.mjs', 'windows-package-candidate.test.mjs', ...shared]
      : target === 'linux-x64'
        ? ['runtime-file-policy.test.mjs', 'workspace-runtime-packaging.test.mjs', 'packaged-resource-contract.test.mjs', ...shared]
        : ['smoke-macos-package.test.mjs', ...shared]
    steps = [step('node-contracts', node, ['--test', ...tests.map(script)])]
    if (target === 'windows-x64') steps.push(step('windows-journal-contract', 'pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script('windows-smoke-journal.test.ps1')]))
  } else if (stage === 'unpacked') {
    scope = 'native-unpacked'
    steps = [nodeStep('windows-unpacked', 'smoke-windows-unpacked.mjs', [], 180_000)]
  } else if (target === 'windows-x64') {
    const directory = join(repositoryRoot, '.artifacts/desktop-windows')
    steps = [
      nodeStep('windows-candidate', 'windows-package-candidate.mjs', [
        'verify', repositoryRoot, join(directory, 'DeepSeek-Harness-windows-x64.exe'),
        join(repositoryRoot, '.artifacts/bundled-plugin-snapshot'), join(directory, 'windows-package-candidate.json'),
      ]),
      step('windows-installed', 'pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script('smoke-windows-package.ps1')], 3_600_000),
      { ...nodeStep('windows-evidence', 'collect-windows-smoke-evidence.mjs', [], 60_000), always: true },
    ]
  } else if (target === 'linux-x64') {
    scope = 'resources-only'
    steps = [nodeStep('linux-resources', 'verify-prebuilt-profile.mjs', [join(repositoryRoot, '.artifacts/desktop-linux/linux-unpacked/resources')], 300_000)]
  } else {
    const arch = TARGETS[target][1]
    steps = [nodeStep('macos-final-archives', 'smoke-macos-package.mjs', ['dmg', 'zip'].map(extension =>
      join(repositoryRoot, '.artifacts/desktop-macos', `DeepSeek-Harness-macos-${arch}.${extension}`)), 1_800_000)]
  }
  return { stage, target, scope, steps }
}

/** Run one shell-free command with a fixed deadline and inherited native output. */
function runCommand(step, options) {
  const result = spawnSync(step.command, step.args, {
    cwd: options.cwd, env: options.env, stdio: 'inherit', windowsHide: true,
    timeout: step.timeoutMs, killSignal: 'SIGKILL',
  })
  return {
    code: result.status, signal: result.signal,
    timedOut: result.error?.code === 'ETIMEDOUT', failed: result.error !== undefined,
  }
}

async function writeSummary(path, records) {
  await mkdir(resolve(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
}

/** Execute qualification fail-fast; evidence and summary failures never replace its result. */
export async function executeSmoke(request, options = {}) {
  const repositoryRoot = options.repositoryRoot ?? REPOSITORY_ROOT
  const plan = createSmokePlan(request, repositoryRoot, options.node ?? process.execPath)
  const expected = TARGETS[plan.target]
  if ((options.platform ?? process.platform) !== expected[0] || (options.arch ?? process.arch) !== expected[1]) {
    throw new Error(`desktop smoke: ${plan.target} requires its matching native host`)
  }
  const environment = { ...(options.environment ?? process.env) }
  if (plan.stage === 'package' && plan.target === 'windows-x64') {
    if (typeof environment.RUNNER_TEMP !== 'string' || !isAbsolute(environment.RUNNER_TEMP)) {
      throw new Error('desktop smoke: Windows package requires an absolute RUNNER_TEMP directory')
    }
    // Keep this owned directory after qualification: a failed installed app may still be alive.
    // Upload only the bounded collector destination, never this raw data directory.
    environment.RUNNER_TEMP = await mkdtemp(join(environment.RUNNER_TEMP, 'desktop-smoke-'))
    environment.TEMP = environment.RUNNER_TEMP
    environment.TMP = environment.RUNNER_TEMP
  }
  const run = options.run ?? runCommand
  const records = []
  let exitCode = 0
  for (const step of plan.steps) {
    if (exitCode !== 0 && !step.always) continue
    const started = performance.now()
    let result
    try {
      result = await run(step, { cwd: repositoryRoot, env: environment })
    } catch {
      result = { code: null, signal: null, timedOut: false, failed: true }
    }
    const code = Number.isInteger(result?.code) ? result.code : null
    const signal = typeof result?.signal === 'string' && /^SIG[A-Z0-9]+$/u.test(result.signal) ? result.signal : null
    const timedOut = result?.timedOut === true
    const failed = code !== 0 || signal !== null || timedOut || result?.failed === true
    records.push({
      stepId: step.id, outcome: failed ? 'failed' : 'passed',
      durationMs: Math.round(performance.now() - started), code, signal, timedOut,
      target: plan.target, stage: plan.stage,
    })
    if (failed && !step.always) exitCode = code !== null && code > 0 && code <= 255 ? code : 1
    if (failed && step.always) console.warn('Desktop smoke evidence unavailable; qualification result is unchanged.')
  }
  const summaryPath = join(repositoryRoot, '.artifacts/desktop-smoke', `${plan.stage}-${plan.target}.json`)
  let summaryWritten = true
  try {
    await (options.writeSummary ?? writeSummary)(summaryPath, records)
  } catch {
    summaryWritten = false
    console.warn('Desktop smoke summary unavailable; qualification result is unchanged.')
  }
  return { exitCode, records, summaryWritten, scope: plan.scope }
}

/** Run the fixed CLI; preview does not require the matching host or package artifacts. */
export async function main(args = process.argv.slice(2)) {
  const request = parseSmokeArguments(args)
  if (request.plan) {
    console.log(JSON.stringify(createSmokePlan(request), null, 2))
    return 0
  }
  const result = await executeSmoke(request)
  console.log(`Desktop smoke ${request.stage} ${request.target}: ${result.exitCode === 0 ? 'passed' : 'failed'} (scope: ${result.scope})`)
  return result.exitCode
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code }, () => {
    console.error('Desktop smoke could not start: check the fixed arguments, native host, and required input directories.')
    process.exitCode = 1
  })
}
