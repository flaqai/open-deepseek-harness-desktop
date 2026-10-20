import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareWindowsInstallerTools } from './prepare-windows-installer-tools.mjs'

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryDirectory = resolve(desktopDirectory, '../..')

/**
 * Compile the production NSIS templates with an inert payload; never execute the resulting EXE.
 * @param {string} artifactDirectory Private parent directory for generated compiler fixtures and logs.
 * @returns {Promise<{directory: string, installers: string[]}>} Generated compile-only fixtures.
 */
export async function compileWindowsInstallerFixture(artifactDirectory) {
  await prepareWindowsInstallerTools({ repositoryRoot: repositoryDirectory })
  const desktopRequire = createRequire(join(desktopDirectory, 'package.json'))
  const { build, Platform, Arch } = desktopRequire('electron-builder')
  const builderRequire = createRequire(desktopRequire.resolve('electron-builder'))
  const nsisUtilities = builderRequire('app-builder-lib/out/targets/nsis/nsisUtil')
  const { NsisTarget } = builderRequire('app-builder-lib/out/targets/nsis/NsisTarget')
  const manifest = JSON.parse(await readFile(join(desktopDirectory, 'package.json'), 'utf8'))
  await mkdir(artifactDirectory, { recursive: true })
  const directory = await mkdtemp(join(artifactDirectory, 'nsis-compile-'))
  // NSIS 3.04 aborts on the long pnpm patch-store include paths. Use an unchanged
  // private copy, not a different template or an edit to the installed dependency.
  const templates = join(directory, 'templates')
  await cp(nsisUtilities.nsisTemplatesDir, templates, { recursive: true })
  const application = join(directory, 'unpacked')
  const harness = join(application, 'resources', 'harness')
  await mkdir(harness, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    name: 'dsh-nsis-compile-fixture', version: manifest.version, description: 'Compile-only NSIS fixture',
    author: 'DeepSeek Harness community', private: true,
  }))
  // This payload is deliberately not executable. The check compiles installer bytecode only.
  await writeFile(join(application, 'Issue31 Compiler Fixture.exe'), 'compile-only fixture; do not execute')
  await writeFile(join(harness, 'package.json'), JSON.stringify({ version: manifest.version }))
  const previousTemplates = nsisUtilities.nsisTemplatesDir
  const previousUninstallerBuilder = NsisTarget.prototype.computeScriptAndSignUninstaller
  nsisUtilities.nsisTemplatesDir = templates
  // The normal builder may execute a temporary EXE to materialize its uninstaller.
  // Use its built-in byte reader exclusively in this compile-only check.
  NsisTarget.prototype.computeScriptAndSignUninstaller = async function (defines, commands, installerPath, sharedHeader, architectures) {
    const script = await readFile(join(templates, 'installer.nsi'), 'utf8')
    const uninstallerPath = join(directory, 'compile-only-uninstaller.exe')
    defines.BUILD_UNINSTALLER = null
    defines.UNINSTALLER_OUT_FILE = uninstallerPath
    await this.executeMakensis(defines, commands, sharedHeader + await this.computeFinalScript(script, false, architectures))
    await nsisUtilities.UninstallerReader.exec(installerPath, uninstallerPath)
    delete defines.BUILD_UNINSTALLER
    defines.UNINSTALLER_OUT_FILE = uninstallerPath
    return { script, isCustomScript: false }
  }
  let installers
  try {
    installers = await build({
      projectDir: directory,
      prepackaged: application,
      targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
      publish: 'never',
      config: {
        appId: 'ai.flaq.deepseek-harness.installer-compile-fixture',
        productName: 'Issue31 Compiler Fixture',
        electronVersion: manifest.devDependencies.electron,
        npmRebuild: false,
        compression: 'store',
        directories: { buildResources: join(desktopDirectory, 'build'), output: join(directory, 'output') },
        win: { signAndEditExecutable: false, signExecutable: false, artifactName: 'compile-only-windows-${arch}.${ext}' },
        nsis: {
          oneClick: false,
          allowToChangeInstallationDirectory: true,
          include: join(desktopDirectory, 'build', 'installer.nsh'),
          displayLanguageSelector: true,
          installerLanguages: ['zh_CN', 'en_US'],
          differentialPackage: false,
        },
      },
    })
  } catch (error) {
    await writeFile(join(directory, 'compile-error.log'), String(error))
    throw error
  } finally {
    nsisUtilities.nsisTemplatesDir = previousTemplates
    NsisTarget.prototype.computeScriptAndSignUninstaller = previousUninstallerBuilder
  }
  return { directory, installers }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const artifacts = process.argv[2] ? resolve(process.argv[2]) : join(repositoryDirectory, '.artifacts', 'issue31-tools')
    process.env.ELECTRON_BUILDER_CACHE ??= join(artifacts, 'cache')
    console.log(JSON.stringify(await compileWindowsInstallerFixture(artifacts), null, 2))
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
