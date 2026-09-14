/** Build preset dependencies with the packaged runtime; retain only portable, reviewed application state. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { basename, delimiter, dirname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { parseBundledPluginManifest } from '../lib/bundled-plugin-installer.js'
import { seedBundledPlugin } from '../lib/bundled-plugin-seed.js'
import { deployPrebuiltProfile, readPrebuiltProfile, sealPrebuiltProfile } from '../lib/prebuilt-profile.js'
import { runHarnessInvocation, windowsTaskkillInvocation } from '../lib/harness-invocation.js'
import { HarnessSupervisor } from '../lib/supervisor.js'

async function smokeRelocatedProfile(home, harnessRoot, node, environment) {
  let supervisor
  let timer
  try {
    const url = await new Promise((resolve, reject) => {
      supervisor = new HarnessSupervisor({
        launch: { command: node, args: [join(harnessRoot, 'lib/bin.js'), 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], cwd: harnessRoot },
        environment, logPath: join(home, 'qualification.log'),
        onReady: resolve, onDiagnosticReady: () => reject(new Error('prebuilt smoke must use the normal Profile')),
        onState: () => {}, onFailure: failure => reject(new Error(failure.message)),
        ...(process.platform === 'win32' ? { terminateProcessTree: async (pid, force) => {
          const invocation = windowsTaskkillInvocation(pid, force, environment)
          await runHarnessInvocation({ command: invocation.command, args: [...invocation.args], environment }, {
            kind: 'prebuilt-smoke-stop', timeoutMs: 10_000, signal: new AbortController().signal, acceptedExitCodes: [0, 128],
          })
        } } : {}),
      })
      timer = setTimeout(() => reject(new Error('prebuilt relocated Harness readiness timed out')), 180_000)
      supervisor.start()
    })
    const exchange = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    const cookie = exchange.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const response = exchange.status >= 300 && exchange.status < 400
      ? await fetch(new URL('/', url), { headers: { cookie }, signal: AbortSignal.timeout(15_000) })
      : exchange
    if (!response.ok) throw new Error(`prebuilt relocated client returned HTTP ${response.status}`)
    await response.arrayBuffer()
    console.log('prebuilt-profile: relocated normal Harness and client HTTP passed')
  } finally {
    clearTimeout(timer)
    await supervisor?.stop()
  }
}

async function signNativeResources(root, run) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) await signNativeResources(path, run)
    else if (entry.isFile()) {
      const file = await open(path, 'r')
      const magic = Buffer.alloc(4)
      try { await file.read(magic, 0, 4, 0) } finally { await file.close() }
      if (['cffaedfe', 'cefaedfe', 'feedfacf', 'feedface', 'cafebabe', 'bebafeca'].includes(magic.toString('hex'))) {
        await run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', path])
        await run('/usr/bin/codesign', ['--verify', '--strict', path])
      }
    }
  }
}

/** Keep the native terminal payload that can execute on the packaged target. */
export async function pruneForeignNodePtyPrebuilds(home, target) {
  if (!/^(?:darwin-(?:arm64|x64)|linux-x64|win32-x64)$/u.test(target)) {
    throw new Error(`invalid prebuilt target ${target}`)
  }
  const packageRoot = join(home, 'profiles/web/node_modules/node-pty')
  let prebuilds
  try { prebuilds = join(await realpath(packageRoot), 'prebuilds') } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  for (const entry of await readdir(prebuilds, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== target) {
      await rm(join(prebuilds, entry.name), { recursive: true, force: true })
    }
  }
  const conpty = join(await realpath(packageRoot), 'third_party/conpty')
  if (!target.startsWith('win32-')) {
    await rm(conpty, { recursive: true, force: true })
    return
  }
  const windowsTarget = `win10-${target.slice('win32-'.length)}`
  let versions
  try { versions = await readdir(conpty, { withFileTypes: true }) } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  for (const version of versions) {
    if (!version.isDirectory()) continue
    const directory = join(conpty, version.name)
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== windowsTarget) {
        await rm(join(directory, entry.name), { recursive: true, force: true })
      }
    }
  }
}

/** Build scripts provide a bounded child runner and the platform's packaged executables. */
export async function preparePrebuiltProfile({ destination: published, harnessRoot, node, pnpm, resources, target, nodeVersion, pnpmVersion, run }) {
  if (!/^desktop-prebuilt-(?:darwin-(?:arm64|x64)|linux-x64|win32-x64)$/u.test(basename(published))) throw new Error('invalid prebuilt output directory')
  const destination = await mkdtemp(join(dirname(published), 'prebuilt-build-'))
  const source = await readFile(join(resources, 'manifest.json'), 'utf8')
  const manifest = parseBundledPluginManifest(JSON.parse(source))
  const runtime = JSON.parse(await readFile(join(harnessRoot, 'package.json'), 'utf8'))
  const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD|^DSH_/iu.test(name)))
  const environment = home => ({ ...cleanEnvironment, DSH_HOME: home, DSH_PNPM_BIN: pnpm,
    DSH_PLUGIN_SNAPSHOT_BATCH: '1', DSH_DESKTOP_BUNDLED_PLUGINS_DIR: resources,
    PATH: `${join(node, '..')}${delimiter}${process.env.PATH ?? ''}` })
  const command = (home, args) => runHarnessInvocation({ command: node,
    args: [join(harnessRoot, 'lib/bin.js'), 'plugin', '--profile', 'web', ...args], environment: environment(home), cwd: harnessRoot,
  }, { kind: 'prebuilt-profile-prepare', timeoutMs: 600_000, signal: new AbortController().signal })
  for (const entry of manifest.plugins.filter(entry => entry.installPolicy === 'startup')) {
    await seedBundledPlugin({ entry, resourcesDirectory: resources, dshHome: destination,
      prepare: async () => { for (const name of entry.approvedBuilds ?? []) await command(destination, ['approve-build', name]) },
      install: archive => command(destination, ['add', '--save-exact', archive]),
    })
  }
  await pruneForeignNodePtyPrebuilds(destination, target)
  const workspace = parseYaml(await readFile(join(destination, 'profiles/web/pnpm-workspace.yaml'), 'utf8'))
  // Never deliver package-manager stores, logs, locks, snapshots, or user settings.
  for (const name of await readdir(destination)) {
    if (!['profiles', 'bundled-plugins'].includes(name)) await rm(join(destination, name), { recursive: true, force: true })
  }
  for (const name of await readdir(join(destination, 'profiles'))) {
    if (name !== 'web') await rm(join(destination, 'profiles', name), { recursive: true, force: true })
  }
  await rm(join(destination, 'profiles/web/cordis.patch.yml'), { force: true })
  // Seal after native signing. Builder must not rewrite these checksummed data resources.
  if (target.startsWith('darwin-')) await signNativeResources(destination, run)
  const sealed = await sealPrebuiltProfile(destination, {
    target, nodeVersion, pnpmVersion, runtimeVersion: runtime.version,
    pluginManifestSha256: createHash('sha256').update(source).digest('hex'),
  }, workspace?.allowBuilds ?? {}, harnessRoot)
  const verified = await readPrebuiltProfile(destination)
  if (verified === undefined) throw new Error('prebuilt Profile manifest was not written')
  const relocated = `${destination} relocated smoke`
  await mkdir(relocated, { recursive: true })
  try {
    await deployPrebuiltProfile(destination, relocated, verified, new AbortController().signal, () => {})
    await command(relocated, ['doctor'])
    await smokeRelocatedProfile(relocated, harnessRoot, node, environment(relocated))
    // Exercise the installed dependency graph without accessing a registry.
    const removable = manifest.plugins.find(entry => entry.installPolicy === 'startup')
    if (removable === undefined) throw new Error('prebuilt Profile has no startup plugins')
    await command(relocated, ['remove', removable.packageName, '--config.offline=true'])
  } finally {
    await rm(relocated, { recursive: true, force: true })
  }
  await rm(published, { recursive: true, force: true })
  await rename(destination, published)
  console.log(`prebuilt-profile: ${sealed.fingerprint}; ${sealed.files.length} resources verified after relocation`)
}
