import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const installerPath = fileURLToPath(new URL('../build/installer.nsh', import.meta.url))

function macro(source: string, name: string) {
  const match = source.match(new RegExp(`!macro ${name}\\r?\\n([\\s\\S]*?)!macroend`))
  if (!match) throw new Error(`Missing installer macro ${name}`)
  return match[1]!
}

describe('Windows uninstall file-transaction integration', () => {
  it('embeds the native transaction beside both the legacy bridge and new uninstaller', async () => {
    const source = await readFile(installerPath, 'utf8')
    for (const name of ['customUninstallOldVersion', 'customUnInit']) {
      const body = macro(source, name)
      for (const file of ['installer-removal.ps1', 'installer-removal-native.cs']) {
        expect(body).toContain(`File /oname=$PLUGINSDIR\\${file} "\${BUILD_RESOURCES_DIR}\\${file}"`)
      }
    }
  })

  it('keeps initialization and the pre-removal hook free of CLI and data mutations', async () => {
    const source = await readFile(installerPath, 'utf8')
    for (const name of ['customUnInit', 'customUnInstall']) {
      const body = macro(source, name)
      expect(body).not.toContain('nsExec::')
      expect(body).not.toContain('DeleteReg')
      expect(body).not.toContain('Call un.RemoveInstalledDesktopData')
      expect(body).not.toMatch(/\b(?:Delete|RMDir)\s/)
    }
  })

  it('stops a failed file phase before CLI, user-data, or upstream metadata cleanup', async () => {
    const body = macro(await readFile(installerPath, 'utf8'), 'customRemoveFiles')
    const invocation = body.indexOf('-File "$PLUGINSDIR\\installer-removal.ps1"')
    const failure = body.indexOf('${If} $0 != 0', invocation)
    const abort = body.indexOf('SetErrorLevel 2\n      Abort', failure)
    const success = body.indexOf('uninstall-files-complete', abort)
    const cli = body.indexOf('-Action remove -Directory "$2"')
    const data = body.indexOf('Call un.RemoveInstalledDesktopData')
    expect(invocation).toBeGreaterThanOrEqual(0)
    expect(failure).toBeGreaterThan(invocation)
    expect(abort).toBeGreaterThan(failure)
    expect(success).toBeGreaterThan(abort)
    expect(cli).toBeGreaterThan(success)
    expect(data).toBeGreaterThan(cli)
    expect(body).toContain('-InstallDirectory "$INSTDIR" -UninstallerName "${UNINSTALL_FILENAME}" -DiagnosticDirectory "$DesktopDiagnosticDirectory"')
    expect(body).toContain('SetOutPath "$TEMP"')
    expect(body).not.toContain('RMDir /r $INSTDIR')
  })

  it('requires explicit data deletion and honors both update and keep-data flags', async () => {
    const source = await readFile(installerPath, 'utf8')
    const body = macro(source, 'customRemoveFiles')
    const updated = body.indexOf('${GetOptions} $R0 "--updated" $R1')
    const keep = body.indexOf('${GetOptions} $R0 "/KEEP_APP_DATA" $R1')
    const selected = body.indexOf('ReadINIStr $R0 "$PLUGINSDIR\\desktop-uninstall.ini" "data" "delete"')
    expect(updated).toBeGreaterThanOrEqual(0)
    expect(keep).toBeGreaterThan(updated)
    expect(selected).toBeGreaterThan(keep)
    expect(body.indexOf('${If} $R0 == "1"', selected)).toBeGreaterThan(selected)
    expect(source).toContain('LangString UninstallFilesFailed 2052')
    expect(source).toContain('LangString UninstallFilesFailed 1033')
  })
})
