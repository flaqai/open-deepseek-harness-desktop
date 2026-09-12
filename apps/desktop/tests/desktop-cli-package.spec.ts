import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))

describe('packaged desktop CLI inputs', () => {
  it('ships only dsh and keeps silent installation opt-in', async () => {
    const cliDirectory = fileURLToPath(new URL('../build/cli-bin/', import.meta.url))
    await expect(access(`${cliDirectory}dsh.cmd`)).resolves.toBeUndefined()
    await expect(access(`${cliDirectory}manage-path.ps1`)).resolves.toBeUndefined()
    await expect(access(`${cliDirectory}npm.cmd`)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(`${cliDirectory}pnpm.cmd`)).rejects.toMatchObject({ code: 'ENOENT' })

    const installer = await readFile(`${desktopRoot}/build/installer.nsh`, 'utf8')
    const pathManager = await readFile(`${desktopRoot}/build/cli-bin/manage-path.ps1`, 'utf8')
    const windowsSmoke = await readFile(`${desktopRoot}/scripts/smoke-windows-package.ps1`, 'utf8')
    expect(installer).toContain('StrCpy $CliPathRequested "0"')
    expect(installer.match(/\$\{StdUtils\.GetParameter\} \$1 "ADDCLI" ""/g)).toHaveLength(2)
    expect(installer).not.toContain('${GetOptions}')
    expect(installer).toContain('${If} $1 == "1"')
    expect(installer).toContain('DetailPrint "Desktop CLI PATH requested: $CliPathRequested"')
    expect(installer).not.toContain('DeepSeek-Harness-installer-diagnostic.txt')
    expect(installer).toContain('/SD IDOK')
    expect(pathManager).toContain("[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')")
    expect(pathManager).toContain("$environmentKey.SetValue('Path', $updated, $pathKind)")
    expect(pathManager).toContain('public static extern bool SendNotifyMessage(')
    expect(pathManager).not.toContain("[Environment]::SetEnvironmentVariable('Path', $updated, 'User')")
    expect(pathManager).not.toContain('SendMessageTimeout')
    expect(installer).toContain('!macro customHeader')
    expect(installer).toContain('Page custom CliPathPageCreate CliPathPageLeave')
    expect(installer).toContain('!macro customUnInit')
    expect(installer).toContain('!macro customUnInstall')
    expect(installer).toContain('File /oname=$PLUGINSDIR\\manage-path.ps1')
    expect(installer).toContain('-File "$PLUGINSDIR\\manage-path.ps1" -Action remove -Directory "$2"')
    expect(installer).toContain('ReadRegStr $2 HKCU "${CLI_PATH_REGISTRY_KEY}" "${CLI_PATH_DIRECTORY_VALUE}"')
    expect(windowsSmoke).toContain('$uninstallDeadline = (Get-Date).AddMinutes(2)')
    expect(windowsSmoke).toContain('$pathRestored -and $registrationRemoved -and $installationRemoved')
    expect(installer).not.toContain('dangerouslyAllowAllBuilds')
  })

  it('packages the launcher as ESM on Windows and macOS', async () => {
    for (const config of ['electron-builder.yml', 'electron-builder.macos.yml']) {
      const source = await readFile(`${desktopRoot}/${config}`, 'utf8')
      expect(source).toContain('from: lib/desktop-cli-launcher.js')
      expect(source).toContain('to: cli/desktop-cli.mjs')
    }
  })

  it('retains both installed startup logs and quarantine evidence before plugin assertions', async () => {
    const source = await readFile(`${desktopRoot}/scripts/smoke-windows-package.ps1`, 'utf8')
    expect(source.indexOf('First installed startup log:')).toBeLessThan(
      source.lastIndexOf('Remove-Item -LiteralPath $harnessLog'),
    )
    expect(source).toContain('Restarted installed startup log:')
    expect(source.indexOf('Installed smoke quarantine evidence:')).toBeLessThan(
      source.indexOf('Bundled plugin dependency $($plugin.PackageName) is absent'),
    )
  })
})
