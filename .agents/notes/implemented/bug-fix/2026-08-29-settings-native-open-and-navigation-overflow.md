# Agent Note: Keep settings actions and contributed navigation reachable

Status: implemented

English | [中文](2026-08-29-settings-native-open-and-navigation-overflow.zh.md)

## Problem

The settings document action used the native path opener, whose Windows adapter spawned the bare name `powershell.exe`. A restricted Host `PATH` made the button fail even though Windows and its file association were available. The settings navigation also had no bounded scrolling child, so contributed section rows beyond the panel height were clipped by the panel overflow rule. Long translated navigation labels and Agent-preset badges could overflow their fixed single-line rows and card headers, while several settings sections selected responsive layouts from the complete browser width instead of their narrower content column.

## Decision

Native Windows resolves the inbox PowerShell executable from `SystemRoot`, with `WINDIR` and the standard Windows directory as fallbacks. The adapter keeps shell-free argv execution and uses the bare command name only for WSL interop, where the Linux process cannot address a native Windows filesystem path directly.

The settings header places a desktop-owned log-directory action immediately before the settings-document action. Its narrow preload operation creates and opens only the fixed desktop log directory; the renderer cannot read or supply a filesystem path.

The settings rail keeps its title outside a dedicated navigation scrollport. The rail and list may shrink in a bounded flex column, while each contributed row grows to show its complete localized label. The scrollport contains wheel overscroll and reserves a stable themed scrollbar gutter. Settings overlays size themselves against their own renderer viewport.

Agent-preset cards allow names and status tags to wrap within each card instead of forcing neighboring cards apart. Settings sections whose multi-column content depends on the available section width use named inline-size containers; their single-column fallbacks therefore follow the settings content column rather than the complete browser viewport. Text identities retain `min-width: 0` and break unbounded user or provider values inside their owner.

The shared body-portaled `Modal`, onboarding takeover, connection banner, attachment drop overlay, and image lightbox use their complete renderer viewport. Default modal content has an internal scrollport, and both sides of the multi-column setup wizard have bounded scrolling. These rules keep controls reachable in short windows or at high display scaling.

## Alternatives considered

**Keep invoking bare `powershell.exe` and repair the Host PATH.** This would leave a user-facing file action dependent on mutable process-environment composition and would regress whenever a restricted launcher omitted Windows system paths. Resolving the inbox executable directly gives the native adapter a deterministic dependency without broadening every child process PATH.

**Scroll the complete settings panel or navigation rail.** Scrolling the outer overlay would move its title and actions, while scrolling the whole rail would also move the navigation heading. A dedicated shrinking list scrollport keeps persistent controls fixed and makes only the unbounded contributed rows scroll.

**Keep every navigation label on one line and widen the rail.** A wider rail would permanently reduce every settings page and still fail for sufficiently long plugin-contributed labels. Variable-height rows preserve the complete label and use the existing scrollport for the additional vertical space.

**Use viewport media queries for settings cards.** The modal navigation consumes part of that viewport, so a section can remain in a two-column viewport breakpoint after its actual content column is too narrow. Container queries make the layout decision from the space the section can use.

**Add a custom-titlebar offset to settings or other portals.** Portal-specific offsets duplicate desktop geometry in Web components and cannot constrain third-party full-viewport content. The desktop host instead gives Harness a native content viewport that already excludes window chrome.

## Consequences

Opening the settings document no longer depends on inherited Windows PATH entries, and the adjacent log-directory action provides a direct path to local diagnostics without exposing arbitrary path opening to Web content. An arbitrary number of plugin-contributed settings sections remains reachable by pointer, wheel, and keyboard focus without moving the settings title, and translated labels remain readable without guessing from ellipses. Preset cards, plugin inventory, external tools, imported-plugin recovery, and snapshot controls reflow within the actual content column. Body-portaled configuration dialogs remain within the available renderer height without desktop-specific offsets.
