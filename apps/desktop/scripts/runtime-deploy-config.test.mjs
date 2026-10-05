import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

for (const script of ['prepare-unix-runtime.mjs', 'prepare-windows-runtime.mjs']) {
  test(`${script} allows target-specific patches to remain unused`, async () => {
    const source = await readFile(new URL(script, import.meta.url), 'utf8')
    assert.match(source, /'--config\.allow-unused-patches=true'/u)
  })
}

test('Windows installed smoke isolates Electron application data', async () => {
  const source = await readFile(new URL('smoke-windows-package.ps1', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /win-unpacked/u)
  assert.match(source, /--dsh-package-smoke-root=\$desktopAppDataRoot/u)
  assert.match(source, /--dsh-native-smoke/u)
  assert.match(source, /RedirectStandardError = \$true/u)
  assert.match(source, /desktop-entry\.log/u)
  for (const phase of [
    'package-contract', 'install', 'native-entry', 'first-start', 'process-guard',
    'upgrade', 'restart', 'cli', 'plugins', 'uninstall',
  ]) assert.match(source, new RegExp(`Start-SmokePhase -Name '${phase}'`, 'u'))
  assert.match(source, /Complete-SmokeJournal -Outcome 'passed'/u)
  assert.match(source, /catch \{\s+Complete-SmokeJournal -Outcome 'failed'\s+throw\s+\}/u)
})

test('Windows unpacked probe checks packaged peers, Electron entries, and managed CLI launch', async () => {
  const source = await readFile(new URL('smoke-windows-unpacked.mjs', import.meta.url), 'utf8')
  for (const packageName of ['@deepseek-ai/dsh-subprocess', '@deepseek-ai/cordis', '@deepseek-ai/dsh-http-proxy']) {
    assert.match(source, new RegExp(packageName.replaceAll('/', '\\/'), 'u'))
  }
  assert.match(source, /DSH_NATIVE_SMOKE_READY/u)
  assert.match(source, /DSH_MAIN_IMPORT_SMOKE_READY/u)
  assert.match(source, /DSH_MANAGED_CLI_SMOKE_READY/u)
  assert.match(source, /--dsh-main-import-smoke/u)
  assert.match(source, /--dsh-managed-cli-smoke/u)
  assert.match(source, /runElectronPackageProbe\(\{ executable, args: \[argument\], marker, timeoutMs \}\)/u)
  assert.match(source, /timeoutMs = 30_000/u)
  assert.match(source, /'DSH_MANAGED_CLI_SMOKE_READY', 60_000/u)
  assert.match(source, /primary-runtime-lock\.json/u)
  assert.doesNotMatch(source, /\bspawn\(|stdout\.includes\(/u)
  const entry = await readFile(new URL('../src/entry.ts', import.meta.url), 'utf8')
  assert.match(entry, /lifecycle: 'client'/u)
  assert.match(entry, /DSH_MANAGED_CLIENT_SMOKE_READY/u)
  assert.match(entry, /handle\.waitForExit/u)
  assert.match(entry, /console\.log\('DSH_MANAGED_CLI_SMOKE_READY'\)/u)
})

test('Windows readiness fails on terminal supervisor errors but permits recoverable plugin errors', async () => {
  const source = await readFile(new URL('smoke-windows-package.ps1', import.meta.url), 'utf8')
  const pattern = source.match(/if \(\$LogText -match '([^']+)'\)/u)?.[1]
  assert.ok(pattern, 'PowerShell startup classifier must be present')
  const fatal = new RegExp(pattern.replace('(?m)', ''), 'm')
  for (const message of [
    'Harness process owner failed and cleanup is unconfirmed: invalid Windows start request',
    'Harness process owner could not start: missing recovery root',
    'Harness process range did not become idle; automatic restart is blocked.',
    'Harness startup failed after 3 attempts: exit 1',
  ]) {
    assert.ok(fatal.test(`[2026-09-19T00:00:00Z] [desktop-supervisor] [error] ${message}`), message)
  }
  for (const line of [
    '[2026-09-19T00:00:00Z] [harness-stderr] [error] optional plugin failed',
    '[2026-09-19T00:00:00Z] [desktop-supervisor] [info] Harness exited code=1 signal=null',
    '[2026-09-19T00:00:00Z] [harness-stdout] [info] dsh web: http://127.0.0.1:1234',
  ]) assert.equal(fatal.test(line), false, line)
  assert.equal(source.match(/Assert-HarnessStartupHealthy \$startupLog/gu)?.length, 2)
  assert.match(source, /Diagnostic Profile readiness does not verify the active Profile/u)
  assert.match(source, /First-start bundled plugin preparation committed after normal readiness/u)
  assert.match(source, /event-dispatch is ready/u)
  assert.equal(source.match(/Test-InstalledDesktopReady -LogText \$startupLog -FirstStart \$(?:true|false)/gu)?.length, 2)
  assert.equal(source.match(/\$appStdout = \$app\.StandardOutput\.ReadToEndAsync\(\)/gu)?.length, 2)
  assert.equal(source.match(/\$appStderr = \$app\.StandardError\.ReadToEndAsync\(\)/gu)?.length, 2)
})

test('Windows smoke evidence excludes sensitive process fields and limits content reads to its safe journal', async () => {
  const source = await readFile(new URL('collect-windows-smoke-evidence.mjs', import.meta.url), 'utf8')
  assert.match(source, /open-dsh\/windows-smoke-evidence\/v1/u)
  assert.match(source, /readFile\(journalPath, 'utf8'\)/u)
  assert.doesNotMatch(source, /Get-Content|ExecutablePath|CommandLine/u)
})

test('Desktop ships the runtime peers required by dsh-subprocess', async () => {
  const desktop = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const subprocess = JSON.parse(await readFile(new URL('../../../packages/subprocess/subprocess/package.json', import.meta.url), 'utf8'))
  for (const peer of Object.keys(subprocess.peerDependencies ?? {})) {
    assert.equal(desktop.dependencies?.[peer], subprocess.peerDependencies[peer], `${peer} must be packaged with Desktop`)
  }
})
