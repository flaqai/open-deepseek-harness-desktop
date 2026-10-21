# Agent Note: Bound Windows installer process detection to desktop-owned executables

Status: implemented

English | [中文](2026-08-26-windows-installer-process-guard.zh.md)

## Problem

Electron Builder 26.15.3 treats every process whose executable path starts with the NSIS installation directory as a running application. DeepSeek Harness carries Node, Harness, and plugin executables below that directory, while users may also run an installer or unrelated executable from a path with the same textual prefix. The generic dialog did not name the matched process, so a hidden runtime child or a false prefix match appeared as an invisible DeepSeek Harness instance that could not be closed.

## Decision

The desktop NSIS include replaces the generic check with an installation-owned process guard. It matches only the exact application executable and executables below the `resources` directory boundary, excludes the current installer PID, and reports the matched PID, name, and executable path. Interactive installation asks before cleanup; silent installation performs the same bounded cleanup. The guard first requests GUI processes to close, then force-stops only remaining matches and fails closed with actionable details when elevated processes remain.

A fresh target directory contains neither the desktop executable nor packaged `resources`, so no installed process can lock files there. NSIS detects that state without starting PowerShell and skips process inspection. Existing and partially installed targets still enter the guarded inspection path whenever either installation-owned boundary is present.

Explicit Windows desktop quit also stops the supervised Harness process tree through `taskkill /T`, with `/F` reserved for the bounded timeout. Closing a window to the tray remains an ordinary running state and is intentionally detected during an upgrade.

The custom installer include is expanded before Electron Builder inserts MUI2 and its `MUI_LANGUAGE` macros. Custom Chinese and English `LangString` declarations therefore use the stable Windows LCIDs 2052 and 1033 directly; referring to `${LANG_SIMPCHINESE}` or `${LANG_ENGLISH}` at that point leaves the constants undefined and makes NSIS fail because warnings are treated as errors. The command-line option page functions are emitted through Electron Builder's `customHeader` hook, after MUI2 and languages load, so `MUI_HEADER_TEXT` is available when NSIS expands it.

The uninstaller embeds its PATH-management and file-removal helpers and extracts them into the NSIS plugin directory during `customUnInit`. Its `customRemoveFiles` hook completes the recoverable file phase before removing the recorded CLI PATH entry or explicitly selected personal data. PATH cleanup does not depend on installed resources remaining available, and a failed file phase leaves these later effects untouched.

An old uninstaller can return exit code 2 for file locks or unsupported source and rollback path lengths even when no desktop process remains. Before invoking it, the upgrade coordinator uses extended Unicode handle operations to stage all ordinary files and empty directories, except the exact verified uninstaller, into a flat same-volume quarantine. This avoids both long source names and unknown legacy temporary-path lengths while preserving the original root for registry and shortcut handling. Only actual legacy exit zero commits removal; other outcomes restore files without replacing conflicts and conservatively restore the legacy CLI helper's exact owned changes. Twelve attempts separated by five-second waits remain limited to exit code 2, without killing a running uninstaller or describing every failure as file contention. A failed restoration retains its journal and original bytes; legacy metadata restoration remains independently unverified.

## Alternatives considered

**Match only `DeepSeek Harness.exe`.** This avoids false positives but misses embedded Node and native plugin processes that can still lock files replaced by an upgrade.

**Keep the directory-prefix match and improve the dialog.** Better wording does not prevent an installer or unrelated process in a prefix-similar path from blocking installation or being terminated.

**Always force-close matches without confirmation.** This can interrupt an active desktop-managed `dsh` command. Interactive installation therefore asks first, while explicit silent mode remains non-interactive.

**Bypass the old uninstaller and overwrite its files.** Rejected because stale JavaScript, native modules, or runtime files can survive beside the new version and create an installation that neither release produced.

**Shorten only known long filenames or rename the whole installation root.** Selective shortening cannot cover unknown legacy rollback prefixes or deep empty directories. A root rename does not prove that individual files are unlocked and changes the directory used for legacy metadata cleanup. Per-entry staging keeps that directory stable and detects deny-delete file handles before commit.

## Consequences

An installer or unrelated process in a prefix-similar directory no longer blocks an upgrade or gets terminated. Real application, embedded Node, Harness, and native plugin processes remain protected from in-place replacement. Windows package validation now cleans an orphan embedded Node process, keeps an unrelated sibling process alive, holds an installed executable through the original cleanup window, completes a same-directory atomic upgrade after the lock releases, and proves post-upgrade Harness readiness.

The Windows installer also keeps reviewed Simplified Chinese and English strings without depending on NSIS macro declaration order. Electron Builder's installed uninstaller completes through a temporary self-copy after its launcher can exit, so native package validation waits for the installation directory, current-user PATH entry, and desktop CLI ownership markers to reach their final removed state. Packaging rejects either lifecycle regression before an installer is published.

The long-path transaction adds same-volume rename and durable-journal work, and an interrupted transaction requires explicit recovery instead of automatic replay. Portable filesystem tests cover 259/260/261-character names, rollback conflicts and journal retention; NSIS compile checks cover both embedded helpers. These checks do not verify Windows handle-sharing, ACL behavior, or a real alpha.2 upgrade. Native Windows acceptance remains required before publishing this implementation.
