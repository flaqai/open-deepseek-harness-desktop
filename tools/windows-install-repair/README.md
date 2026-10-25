# Windows installation record repair

English | [中文](README.zh.md)

## Summary

Repair this application's stale Windows installation records after its program directory was manually deleted. The tool supports arbitrary verified local installation paths and both installation scopes; it does not delete program files, configuration, history, or PATH entries.

## Repair a missing installation

Close all Open DeepSeek Harness Desktop installers before starting. Use 64-bit Windows PowerShell on the affected Windows account. If the old program directory still exists, use the normal uninstaller instead; this tool refuses to clear its registration.

1. Obtain this folder from the repository or open `resources/support/windows-install-repair/` in a Windows build that includes it. When using an archive, choose **Extract all** first.
2. For an installation made **only for me**, double-click `START-REPAIR.cmd` on that same Windows account. For an installation made **for all users**, explicitly choose **Run as administrator** on `START-ALL-USERS-REPAIR.cmd`; the tool never elevates itself.
3. Check the installation scope, old directory, and backup location in the confirmation dialog. The default is **No**. Confirm only the intended missing installation.
4. After a completed repair, run the installer again. On an error, keep the complete message and the reported backup directory for diagnosis.

Each launcher contains its complete PowerShell payload and needs no adjacent `.ps1` file. Current-user repair checks only the current account's `HKCU`; all-users repair checks only `HKLM`. Neither mode loads another user's registry hive or changes the other installation scope.

## Safety and diagnostics

The tool checks only this distribution's fixed application registration keys. It requires consistent application identity, version metadata, directory, and uninstall scope. An unavailable drive, access-denied path, reparse point, changed registration, or an existing program directory stops repair instead of being treated as a deleted installation.

Before removing any record, the tool backs up every selected key and rechecks the recorded state. Backups and `repair-result.json` are retained in a unique directory under `%LOCALAPPDATA%\OpenDSH-Repair`. If a removal fails, restoration does not overwrite a concurrently recreated record; preserve the backup and error when restoration cannot be confirmed. Do not import old registration backups after a successful reinstall.

The tool does not repair plugin errors or uninstall an existing application. It does not remove shortcuts, user data, unrelated applications, or other accounts' records. It stops on ambiguous records rather than guessing an installation path.

## Source and verification

The readable entry point in the repository is `tools/windows-install-repair/repair.ps1`, which loads the shared registration module from a full checkout. Its sibling `generate-launchers.mjs` combines those sources into the two self-contained launchers; package builds verify that they match their sources. Packaged support folders contain the launchers and these instructions, without the repository's source dependencies.

PowerShell behavior tests exercise inspection, confirmation, backup, failure, and scope handling. Native Windows installation, registry repair, and uninstall qualification remain necessary before publishing a Windows candidate; portable tests and NSIS compilation alone do not establish that acceptance.
