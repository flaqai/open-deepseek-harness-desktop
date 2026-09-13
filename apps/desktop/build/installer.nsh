!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!define CLI_PATH_REGISTRY_KEY "Software\FLAQ.AI\DeepSeek Harness"
!define CLI_PATH_REGISTRY_VALUE "CliPathRegistered"
!define CLI_PATH_DIRECTORY_VALUE "CliPathDirectory"

# This include is expanded before electron-builder inserts MUI_LANGUAGE, so the
# symbolic LANG_* constants do not exist yet. Use stable Windows LCIDs instead.
LangString CliPageTitle 2052 "命令行工具"
LangString CliPageTitle 1033 "Command-line tool"
LangString CliPageSubtitle 2052 "选择是否在终端中直接使用客户端内置的 dsh"
LangString CliPageSubtitle 1033 "Choose whether the desktop-managed dsh is available in terminals"
LangString CliPathCheckbox 2052 "将 dsh 添加到当前用户 PATH"
LangString CliPathCheckbox 1033 "Add dsh to the current-user PATH"
LangString CliPathDescription 2052 "不会注册 npm 或 pnpm，也不会修改 DSH_HOME。dsh 会跟随客户端中选择的数据目录；安装后请打开新的终端窗口。"
LangString CliPathDescription 1033 "npm, pnpm, and DSH_HOME are not changed. dsh follows the data directory selected in the desktop app. Open a new terminal after installation."
LangString CliConflict 2052 "检测到 PATH 中已有其他 dsh。此选项默认关闭；强制勾选会让客户端内置 dsh 优先。"
LangString CliConflict 1033 "Another dsh was found on PATH. This option stays off by default; selecting it makes the desktop-managed dsh take priority."
LangString CliPathFailure 2052 "无法更新当前用户 PATH。应用已正常安装，但 dsh 命令尚未注册。"
LangString CliPathFailure 1033 "The current-user PATH could not be updated. The app was installed, but dsh was not registered."
LangString AppProcessesRunning 2052 "检测到以下由 DeepSeek Harness 安装目录启动的进程。继续后，安装程序会先请求它们正常退出，随后关闭仍在运行的进程。"
LangString AppProcessesRunning 1033 "The following processes were started from the DeepSeek Harness installation. Continuing asks them to exit and then closes any that remain."
LangString AppProcessesRemain 2052 "仍有进程无法关闭。它们可能使用了更高权限。请根据下方的 PID 和路径手动关闭，然后重试。"
LangString AppProcessesRemain 1033 "Some processes could not be closed, possibly because they run with higher privileges. Close the listed PIDs and paths, then retry."
LangString AppProcessInspectionFailed 2052 "安装程序无法安全检查 DeepSeek Harness 进程。为避免损坏安装，本次操作已停止。"
LangString AppProcessInspectionFailed 1033 "The installer could not safely inspect DeepSeek Harness processes. Installation has stopped to avoid corrupting the application."
LangString UpgradeCleanupFailed 2052 "安装程序已额外等待并重试，但仍无法完整移除旧版本文件。Windows 安全软件、资源管理器或其他程序可能仍在占用安装目录。请暂时关闭这些程序后重新运行安装包。安装程序没有跳过卸载，也没有混合新旧文件。"
LangString UpgradeCleanupFailed 1033 "The installer waited and retried, but Windows still could not completely remove the previous version. Security software, File Explorer, or another program may still be using the installation directory. Close those programs and run the installer again. The installer did not skip uninstall or mix old and new files."
LangString UninstallDataPageTitle 2052 "本地配置和数据"
LangString UninstallDataPageTitle 1033 "Local configuration and data"
LangString UninstallDataPageSubtitle 2052 "选择卸载应用后是否保留个人数据"
LangString UninstallDataPageSubtitle 1033 "Choose whether personal data remains after uninstalling the app"
LangString UninstallDataCheckbox 2052 "同时删除本应用的本地配置和数据"
LangString UninstallDataCheckbox 1033 "Also delete this app's local configuration and data"
LangString UninstallDataDescription 2052 "包括对话历史、模型与凭据设置、插件、插件快照、日志、缓存和桌面偏好。删除可释放磁盘空间，并可能清除由损坏配置引起的错误。"
LangString UninstallDataDescription 1033 "Includes conversation history, model and credential settings, plugins, plugin snapshots, logs, caches, and desktop preferences. Deleting can free disk space and may clear errors caused by damaged configuration."
LangString UninstallDataExternal 2052 "手动选择并直接复用的官方 .dsh、其他外部配置目录，以及同一应用根目录内的源码开发版数据均不会被删除。"
LangString UninstallDataExternal 1033 "A directly reused official .dsh, another external data directory, and source-development data inside the same app root are all preserved."
LangString UninstallDataWarning 2052 "警告：删除后无法恢复。请先备份需要保留的历史记录、配置和插件数据。"
LangString UninstallDataWarning 1033 "Warning: deletion cannot be undone. Back up any history, configuration, and plugin data that you want to keep."
LangString UninstallDataConfirm 2052 "确定要永久删除本应用的全部本地配置和数据吗？$\r$\n$\r$\n其中包括对话历史、模型与凭据设置、插件和快照。此操作无法撤销。"
LangString UninstallDataConfirm 1033 "Permanently delete all local configuration and data owned by this app?$\r$\n$\r$\nThis includes conversation history, model and credential settings, plugins, and snapshots. This cannot be undone."
LangString UninstallDataDeleteFailed 2052 "部分安装版数据无法删除，可能仍被其他进程占用。卸载完成后请关闭相关程序，再清理下列目录中除 development 以外的内容：$\r$\n$APPDATA\open-deepseek-harness-desktop"
LangString UninstallDataDeleteFailed 1033 "Some installed-app data could not be deleted, possibly because another process is still using it. After uninstalling, close that program and remove the contents below except development:$\r$\n$APPDATA\open-deepseek-harness-desktop"

Var ProcessGuardOutput

!macro customCheckAppRunning
  # A fresh installation has no files that can be locked. Avoid invoking CIM
  # until an existing desktop executable or packaged runtime is present.
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" process_guard_inspect
  IfFileExists "$INSTDIR\resources\*.*" process_guard_inspect
  Goto process_guard_done

  process_guard_inspect:
  InitPluginsDir
  File /oname=$PLUGINSDIR\installer-process-guard.ps1 "${BUILD_RESOURCES_DIR}\installer-process-guard.ps1"
  System::Call 'kernel32::GetCurrentProcessId() i.r9'

  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\installer-process-guard.ps1" -Action inspect -InstallDirectory "$INSTDIR" -AppExecutable "${APP_EXECUTABLE_FILENAME}" -ExcludeProcessId $9'
  Pop $0
  Pop $ProcessGuardOutput
  DetailPrint "$ProcessGuardOutput"

  ${If} $0 == 0
    Goto process_guard_done
  ${ElseIf} $0 == 10
    ${IfNot} ${Silent}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(AppProcessesRunning)$\r$\n$ProcessGuardOutput" IDOK process_guard_stop
      Quit
    ${EndIf}
    Goto process_guard_stop
  ${Else}
    FileOpen $3 "$TEMP\DeepSeek-Harness-process-guard.log" w
    FileWrite $3 "inspect-exit=$0$\r$\n$ProcessGuardOutput$\r$\n"
    FileClose $3
    MessageBox MB_RETRYCANCEL|MB_ICONSTOP "$(AppProcessInspectionFailed)$\r$\n$ProcessGuardOutput" /SD IDCANCEL IDRETRY process_guard_inspect
    Quit
  ${EndIf}

  process_guard_stop:
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\installer-process-guard.ps1" -Action stop -InstallDirectory "$INSTDIR" -AppExecutable "${APP_EXECUTABLE_FILENAME}" -ExcludeProcessId $9'
  Pop $0
  Pop $ProcessGuardOutput
  DetailPrint "$ProcessGuardOutput"
  ${If} $0 != 0
    FileOpen $3 "$TEMP\DeepSeek-Harness-process-guard.log" w
    FileWrite $3 "stop-exit=$0$\r$\n$ProcessGuardOutput$\r$\n"
    FileClose $3
    MessageBox MB_RETRYCANCEL|MB_ICONSTOP "$(AppProcessesRemain)$\r$\n$ProcessGuardOutput" /SD IDCANCEL IDRETRY process_guard_inspect
    Quit
  ${EndIf}
  Delete "$TEMP\DeepSeek-Harness-process-guard.log"

  process_guard_done:
!macroend

!ifndef BUILD_UNINSTALLER
  Var CliPathCheckboxHandle
  Var CliPathRequested
  Var UpgradeRetryInstallDir
  Var UpgradeRetryMode

  # Electron Builder gives atomic update cleanup five attempts separated by
  # one-second waits before returning exit code 2. Large packaged runtimes and
  # transient antivirus/indexer locks can outlive that window even when no
  # desktop-owned process is running. Keep the atomic old-version uninstaller
  # contract and grant it one bounded recovery window; never continue on a
  # non-zero result.
  !macro customUnInstallCheck
    Call DesktopHandleOldUninstallResult
  !macroend

  !macro customUnInstallCheckCurrentUser
    Call DesktopHandleOldCurrentUserUninstallResult
  !macroend

  !macro customInit
    StrCpy $CliPathRequested "0"
    ReadRegDWORD $0 HKCU "${CLI_PATH_REGISTRY_KEY}" "${CLI_PATH_REGISTRY_VALUE}"
    ${If} $0 == 1
      StrCpy $CliPathRequested "1"
    ${EndIf}
    ${StdUtils.GetParameter} $1 "ADDCLI" ""
    ${If} $1 == "1"
      StrCpy $CliPathRequested "1"
    ${ElseIf} $1 == "0"
      StrCpy $CliPathRequested "0"
    ${EndIf}
  !macroend

  !macro customPageAfterChangeDir
    Page custom CliPathPageCreate CliPathPageLeave
  !macroend

  # Electron Builder inserts customHeader after MUI2 and the selected languages.
  # Emit the page functions there so their MUI macros are available.
  !macro customHeader
    Function DesktopRetryOldUninstall
      StrCpy $R4 0
      InitPluginsDir
      Delete "$PLUGINSDIR\desktop-old-uninstaller-retry.exe"
      ClearErrors
      CopyFiles /SILENT "$UpgradeRetryInstallDir\${UNINSTALL_FILENAME}" "$PLUGINSDIR\desktop-old-uninstaller-retry.exe"
      IfErrors desktop_upgrade_retry_copy_failed

      desktop_upgrade_retry_loop:
      IntOp $R4 $R4 + 1
      Sleep 5000
      DetailPrint "Retrying atomic old-version cleanup ($R4/12) after exit code 2."
      FileOpen $3 "$TEMP\DeepSeek-Harness-upgrade-cleanup.log" a
      FileWrite $3 "atomic-cleanup-retry=$R4 previous-exit=$R0$\r$\n"
      FileClose $3

      # --updated keeps electron-builder's rollback-capable atomic removal;
      # /KEEP_APP_DATA additionally protects data created by older installers.
      ClearErrors
      ExecWait '"$PLUGINSDIR\desktop-old-uninstaller-retry.exe" /S /KEEP_APP_DATA $UpgradeRetryMode --updated _?=$UpgradeRetryInstallDir' $R0
      IfErrors desktop_upgrade_retry_launch_failed desktop_upgrade_retry_result

      desktop_upgrade_retry_copy_failed:
      desktop_upgrade_retry_launch_failed:
      StrCpy $R0 2
      ClearErrors
      Return

      desktop_upgrade_retry_result:
      ${If} $R0 == 0
        Delete "$TEMP\DeepSeek-Harness-upgrade-cleanup.log"
        Return
      ${EndIf}
      ${If} $R0 != 2
        Return
      ${EndIf}
      ${If} $R4 < 12
        Goto desktop_upgrade_retry_loop
      ${EndIf}
    FunctionEnd

    Function DesktopHandleOldUninstallResult
      IfErrors desktop_uninstall_launch_failed desktop_uninstall_has_result

      desktop_uninstall_launch_failed:
      DetailPrint "Uninstall was not successful. Not able to launch uninstaller."
      Return

      desktop_uninstall_has_result:
      ${If} $R0 == 2
        StrCpy $UpgradeRetryInstallDir "$INSTDIR"
        ${If} $installMode == "CurrentUser"
          StrCpy $UpgradeRetryMode "/currentuser"
        ${Else}
          StrCpy $UpgradeRetryMode "/allusers"
        ${EndIf}
        Call DesktopRetryOldUninstall
      ${EndIf}
      ${If} $R0 != 0
        FileOpen $3 "$TEMP\DeepSeek-Harness-upgrade-cleanup.log" a
        FileWrite $3 "atomic-cleanup-final-exit=$R0$\r$\n"
        FileClose $3
        MessageBox MB_OK|MB_ICONEXCLAMATION "$(UpgradeCleanupFailed)$\r$\n$\r$\n$TEMP\DeepSeek-Harness-upgrade-cleanup.log" /SD IDOK
        DetailPrint "Atomic old-version cleanup failed with exit code $R0."
        SetErrorLevel 2
        Quit
      ${EndIf}
    FunctionEnd

    Function DesktopHandleOldCurrentUserUninstallResult
      IfErrors desktop_current_user_uninstall_launch_failed desktop_current_user_uninstall_has_result

      desktop_current_user_uninstall_launch_failed:
      DetailPrint "Uninstall was not successful. Not able to launch current-user uninstaller."
      Return

      desktop_current_user_uninstall_has_result:
      ${If} $R0 == 2
        ReadRegStr $UpgradeRetryInstallDir HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
        StrCpy $UpgradeRetryMode "/currentuser"
        ${If} $UpgradeRetryInstallDir != ""
          Call DesktopRetryOldUninstall
        ${EndIf}
      ${EndIf}
      ${If} $R0 != 0
        FileOpen $3 "$TEMP\DeepSeek-Harness-upgrade-cleanup.log" a
        FileWrite $3 "atomic-current-user-cleanup-final-exit=$R0$\r$\n"
        FileClose $3
        MessageBox MB_OK|MB_ICONEXCLAMATION "$(UpgradeCleanupFailed)$\r$\n$\r$\n$TEMP\DeepSeek-Harness-upgrade-cleanup.log" /SD IDOK
        DetailPrint "Atomic current-user cleanup failed with exit code $R0."
        SetErrorLevel 2
        Quit
      ${EndIf}
    FunctionEnd

    Function CliPathPageCreate
      ${If} ${Silent}
        Abort
      ${EndIf}
      !insertmacro MUI_HEADER_TEXT "$(CliPageTitle)" "$(CliPageSubtitle)"
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}
      ${NSD_CreateCheckbox} 0 8u 100% 18u "$(CliPathCheckbox)"
      Pop $CliPathCheckboxHandle
      ${If} $CliPathRequested == "1"
        ${NSD_Check} $CliPathCheckboxHandle
      ${EndIf}
      ${NSD_CreateLabel} 12u 34u 94% 42u "$(CliPathDescription)"
      Pop $0
      nsExec::ExecToStack 'where.exe dsh'
      Pop $0
      Pop $1
      ${If} $0 == 0
        ${NSD_CreateLabel} 12u 80u 94% 36u "$(CliConflict)$\r$\n$1"
        Pop $0
        ${If} $CliPathRequested != "1"
          ${NSD_Uncheck} $CliPathCheckboxHandle
        ${EndIf}
      ${EndIf}
      nsDialogs::Show
    FunctionEnd

    Function CliPathPageLeave
      ${NSD_GetState} $CliPathCheckboxHandle $CliPathRequested
    FunctionEnd
  !macroend

  !macro customInstall
    # Re-read the opt-in in the instance that executes the install section.
    # Assisted installers can cross an outer/inner boundary after .onInit, so a
    # Var populated only by customInit is not a reliable silent-install input.
    ${StdUtils.GetParameter} $1 "ADDCLI" ""
    ${If} $1 == "1"
      StrCpy $CliPathRequested "1"
    ${ElseIf} $1 == "0"
      StrCpy $CliPathRequested "0"
    ${EndIf}
    DetailPrint "Desktop CLI PATH requested: $CliPathRequested"
    ${If} $CliPathRequested == "1"
      ReadRegStr $2 HKCU "${CLI_PATH_REGISTRY_KEY}" "${CLI_PATH_DIRECTORY_VALUE}"
      ${If} $2 != ""
      ${AndIf} $2 != "$INSTDIR\resources\cli-bin"
        nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\cli-bin\manage-path.ps1" -Action remove -Directory "$2"'
      ${EndIf}
      nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\cli-bin\manage-path.ps1" -Action add -Directory "$INSTDIR\resources\cli-bin"'
      Pop $0
      Pop $1
      ${If} $0 == 0
        WriteRegDWORD HKCU "${CLI_PATH_REGISTRY_KEY}" "${CLI_PATH_REGISTRY_VALUE}" 1
        WriteRegStr HKCU "${CLI_PATH_REGISTRY_KEY}" "${CLI_PATH_DIRECTORY_VALUE}" "$INSTDIR\resources\cli-bin"
      ${Else}
        DetailPrint "Desktop CLI PATH registration failed (exit $0): $1"
        DeleteRegValue HKCU "${CLI_PATH_REGISTRY_KEY}" "${CLI_PATH_REGISTRY_VALUE}"
        DeleteRegValue HKCU "${CLI_PATH_REGISTRY_KEY}" "${CLI_PATH_DIRECTORY_VALUE}"
        MessageBox MB_OK|MB_ICONEXCLAMATION "$(CliPathFailure)$\r$\n$1" /SD IDOK
      ${EndIf}
    ${Else}
      ReadRegDWORD $0 HKCU "${CLI_PATH_REGISTRY_KEY}" "${CLI_PATH_REGISTRY_VALUE}"
      ${If} $0 == 1
        nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\cli-bin\manage-path.ps1" -Action remove -Directory "$INSTDIR\resources\cli-bin"'
        DeleteRegValue HKCU "${CLI_PATH_REGISTRY_KEY}" "${CLI_PATH_REGISTRY_VALUE}"
        DeleteRegValue HKCU "${CLI_PATH_REGISTRY_KEY}" "${CLI_PATH_DIRECTORY_VALUE}"
      ${EndIf}
    ${EndIf}
  !macroend
!endif

!macro customUnInit
  # The uninstaller owns its PATH cleanup helper. Extracting it from the
  # uninstaller avoids depending on installed resources during the NSIS
  # self-copy and upgrade lifecycle.
  InitPluginsDir
  File /oname=$PLUGINSDIR\manage-path.ps1 "${BUILD_RESOURCES_DIR}\cli-bin\manage-path.ps1"
  ReadRegStr $2 HKCU "${CLI_PATH_REGISTRY_KEY}" "${CLI_PATH_DIRECTORY_VALUE}"
  ${If} $2 == ""
    StrCpy $2 "$INSTDIR\resources\cli-bin"
  ${EndIf}
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\manage-path.ps1" -Action remove -Directory "$2"'
  Pop $0
  Pop $1
  DetailPrint "Desktop CLI PATH cleanup exit $0: $1"
  ${If} $0 == 0
    DeleteRegValue HKCU "${CLI_PATH_REGISTRY_KEY}" "${CLI_PATH_REGISTRY_VALUE}"
    DeleteRegValue HKCU "${CLI_PATH_REGISTRY_KEY}" "${CLI_PATH_DIRECTORY_VALUE}"
  ${EndIf}
!macroend

!ifdef BUILD_UNINSTALLER
  !macro customUnWelcomePage
    !insertmacro MUI_UNPAGE_WELCOME
    UninstPage custom un.UninstallDataPageCreate un.UninstallDataPageLeave
  !macroend

  # As with the installer's CLI page, these functions must be emitted after
  # Electron Builder loads MUI2. The BUILD_UNINSTALLER bootstrap includes this
  # file before MUI_HEADER_TEXT exists.
  !macro customHeader
    Function un.UninstallDataPageCreate
      ${If} ${Silent}
        Abort
      ${EndIf}
      # Updater-driven uninstalls must never offer destructive data removal.
      # Re-evaluate the marker in each relevant callback instead of carrying
      # custom NSIS variables through electron-builder's two compile passes.
      ${GetParameters} $R0
      ${GetOptions} $R0 "--updated" $R1
      ${IfNot} ${Errors}
        Abort
      ${EndIf}
      !insertmacro MUI_HEADER_TEXT "$(UninstallDataPageTitle)" "$(UninstallDataPageSubtitle)"
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}
      ${NSD_CreateCheckbox} 0 8u 100% 20u "$(UninstallDataCheckbox)"
      Pop $R9
      ${NSD_Uncheck} $R9
      ${NSD_CreateLabel} 12u 36u 94% 48u "$(UninstallDataDescription)"
      Pop $0
      ${NSD_CreateLabel} 12u 86u 94% 38u "$(UninstallDataExternal)"
      Pop $0
      ${NSD_CreateLabel} 12u 128u 94% 32u "$(UninstallDataWarning)"
      Pop $0
      SetCtlColors $0 0xA7272D transparent
      nsDialogs::Show
    FunctionEnd

    Function un.UninstallDataPageLeave
      ${NSD_GetState} $R9 $0
      ${If} $0 == ${BST_CHECKED}
        MessageBox MB_YESNO|MB_DEFBUTTON2|MB_ICONEXCLAMATION "$(UninstallDataConfirm)" /SD IDNO IDYES uninstall_data_confirmed
        ${NSD_Uncheck} $R9
        WriteINIStr "$PLUGINSDIR\desktop-uninstall.ini" "data" "delete" "0"
        Abort
        uninstall_data_confirmed:
        WriteINIStr "$PLUGINSDIR\desktop-uninstall.ini" "data" "delete" "1"
      ${Else}
        WriteINIStr "$PLUGINSDIR\desktop-uninstall.ini" "data" "delete" "0"
      ${EndIf}
    FunctionEnd
  !macroend

  Function un.RemoveInstalledDesktopData
    Push $0
    Push $1
    Push $2
    StrCpy $R8 "0"
    StrCpy $0 "$APPDATA\open-deepseek-harness-desktop"
    ClearErrors
    FindFirst $1 $2 "$0\*.*"
    IfErrors uninstall_data_scan_done
    uninstall_data_scan_next:
      StrCmp $2 "." uninstall_data_scan_continue
      StrCmp $2 ".." uninstall_data_scan_continue
      StrCmp $2 "development" uninstall_data_scan_continue
      IfFileExists "$0\$2\*.*" 0 uninstall_data_delete_file
        RMDir /r "$0\$2"
        IfFileExists "$0\$2\*.*" 0 uninstall_data_scan_continue
        StrCpy $R8 "1"
        Goto uninstall_data_scan_continue
      uninstall_data_delete_file:
        Delete "$0\$2"
        IfFileExists "$0\$2" 0 uninstall_data_scan_continue
        StrCpy $R8 "1"
      uninstall_data_scan_continue:
        ClearErrors
        FindNext $1 $2
        IfErrors uninstall_data_scan_close
        Goto uninstall_data_scan_next
    uninstall_data_scan_close:
      FindClose $1
    uninstall_data_scan_done:
      RMDir "$0"
      Pop $2
      Pop $1
      Pop $0
  FunctionEnd

  !macro customUnInstall
    ${GetParameters} $R0
    ${GetOptions} $R0 "--updated" $R1
    ${IfNot} ${Errors}
      DetailPrint "Preserving application-owned local configuration and data during update"
    ${Else}
      ReadINIStr $R0 "$PLUGINSDIR\desktop-uninstall.ini" "data" "delete"
      ${If} $R0 == "1"
      DetailPrint "Removing application-owned local configuration and data"
      ${If} $installMode == "all"
        SetShellVarContext current
      ${EndIf}
      Call un.RemoveInstalledDesktopData
      StrCmp $R8 "0" uninstall_data_removed
        MessageBox MB_OK|MB_ICONEXCLAMATION "$(UninstallDataDeleteFailed)"
      uninstall_data_removed:
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
      ${Else}
        DetailPrint "Preserving application-owned local configuration and data"
      ${EndIf}
    ${EndIf}
  !macroend
!endif
