/** Native menu flow for the desktop-owned dsh command, without renderer filesystem access. */

import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { isAbsolute, join, normalize } from 'node:path'
import { promisify } from 'node:util'
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { desktopDictionary } from './desktop-locale.ts'
import type { DesktopCliStatus } from './desktop-cli-registration.ts'
import { menuCopy } from './application-menu.ts'

const en = {
  location: 'Desktop command: {path}', selected: 'Current dsh command: {path}',
  installed: 'The Desktop dsh command is installed.', missing: 'Add the Desktop dsh command to your terminal?',
  conflict: 'Another dsh command was found. Installing Desktop dsh will not remove it.',
  unknown: 'The current terminal command could not be determined. Check your shell PATH before changing it.',
  linux: 'The official Desktop does not automatically register dsh on Linux. Use your distribution’s installation or add a command to PATH manually.',
  development: 'Command registration is available only in an installed Desktop build.',
  setup: 'Choose a data directory before installing the Desktop command.',
  shell: 'Automatic PATH management does not support this shell. Use the displayed Desktop command path manually.',
  broken: 'The Desktop command registration needs repair in General Settings.',
  continue: 'Continue', install: 'Install', repair: 'Repair', remove: 'Remove', close: 'Close',
  changed: 'The command state changed. Open this menu again to review it.',
  removed: 'The Desktop command was removed; another dsh command was not deleted.',
  newTerminal: 'Open a new terminal window to use the updated PATH.',
  failed: 'Could not manage the dsh command.',
}

const zh: typeof en = {
  location: 'Desktop 命令：{path}', selected: '当前 dsh 命令：{path}',
  installed: '已安装 Desktop dsh 命令。', missing: '将 Desktop dsh 命令添加到终端？',
  conflict: '发现另一个 dsh 命令。安装 Desktop dsh 不会删除它。',
  unknown: '无法确定终端当前使用的命令。更改前请检查 Shell 的 PATH。',
  linux: '官方 Desktop 不在 Linux 上自动注册 dsh。请使用发行版的安装方式，或手动将命令加入 PATH。',
  development: '只有正式安装的 Desktop 版本才能注册命令。',
  setup: '安装 Desktop 命令前，请先选择数据目录。',
  shell: '当前 Shell 不支持自动管理 PATH；可手动使用显示的 Desktop 命令路径。',
  broken: 'Desktop 命令注册需要在“通用设置”中修复。',
  continue: '继续', install: '安装', repair: '修复', remove: '移除', close: '关闭',
  changed: '命令状态已变化，请重新打开此菜单检查。',
  removed: '已移除 Desktop 命令；其他 dsh 命令没有被删除。',
  newTerminal: '请打开新的终端窗口，以使用更新后的 PATH。',
  failed: '无法管理 dsh 命令。',
}

function format(template: string, path: string): string { return template.replace('{path}', path) }

async function fromPath(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv): Promise<string | undefined> {
  const names = platform === 'win32' ? ['dsh.exe', 'dsh.cmd', 'dsh.bat'] : ['dsh']
  for (const part of (environment.PATH ?? '').split(platform === 'win32' ? ';' : ':')) {
    const directory = platform === 'win32' ? part.replace(/^"|"$/gu, '') : part
    if (directory === '' || !isAbsolute(directory)) continue
    for (const name of names) {
      const candidate = join(directory, name)
      try {
        if (!(await stat(candidate)).isFile()) continue
        if (platform !== 'win32') await access(candidate, constants.X_OK)
        return candidate
      } catch { /* continue through PATH */ }
    }
  }
  return undefined
}

/** Inspect selection without executing any dsh binary or changing PATH. */
export async function findCurrentDshCommand(
  platform: NodeJS.Platform, environment: NodeJS.ProcessEnv = process.env,
): Promise<{ path?: string; unknown: boolean }> {
  if (platform === 'darwin') {
    try {
      const shell = userInfo().shell
      if (shell !== null && isAbsolute(shell)) {
        const script = "printf '\\0DSH_COMMAND\\0'; command -v dsh; printf '\\0'"
        const { stdout } = await promisify(execFile)(shell, ['-ilc', script], { timeout: 5000, maxBuffer: 65536 })
        const selected = stdout.split('\0DSH_COMMAND\0')[1]?.split('\0')[0]?.trim()
        if (selected === '') return { unknown: false }
        if (selected !== undefined && isAbsolute(selected) && !/[\r\n]/u.test(selected)) {
          return { path: selected, unknown: false }
        }
      }
    } catch { /* A custom login shell may fail; report selection uncertainty. */ }
    const path = await fromPath(platform, environment)
    return { ...(path === undefined ? {} : { path }), unknown: true }
  }
  const path = await fromPath(platform, environment)
  return { ...(path === undefined ? {} : { path }), unknown: false }
}

/** Narrow operations already provided by Desktop's packaged CLI manager. */
export interface DesktopCliMenuManager {
  getStatus(): Promise<DesktopCliStatus>
  install(force: boolean): Promise<DesktopCliStatus>
  remove(): Promise<DesktopCliStatus>
}

/** Dependencies injected by the privileged desktop host. */
export interface DesktopCliMenuOptions {
  readonly manager: DesktopCliMenuManager
  readonly platform: NodeJS.Platform
  readonly locale: () => string
  readonly show: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>
  readonly findCurrent?: () => Promise<{ path?: string; unknown: boolean }>
}

/** Serialize the visible decision so repeated menu clicks cannot race PATH writes. */
export class DesktopCliMenu {
  private operation: Promise<void> | undefined

  constructor(private readonly options: DesktopCliMenuOptions) {}

  show(): Promise<void> {
    return this.operation ??= this.run().finally(() => { this.operation = undefined })
  }

  private async run(): Promise<void> {
    const t = desktopDictionary(this.options.locale(), { en, zh })
    const title = menuCopy(this.options.locale())['cli-command']
    const present = (options: Omit<MessageBoxOptions, 'title'>): Promise<MessageBoxReturnValue> =>
      this.options.show({ title, ...options })
    try {
      const state = await this.options.manager.getStatus()
      const selected = await (this.options.findCurrent?.() ?? findCurrentDshCommand(this.options.platform))
      const selectedPath = selected.path ?? state.conflictPath
      const normalizeCommand = (path: string): string => {
        const normalized = normalize(path)
        return this.options.platform === 'win32' ? normalized.toLowerCase() : normalized
      }
      const other = selectedPath !== undefined
        && normalizeCommand(selectedPath) !== normalizeCommand(state.commandPath)
      const details = [
        ...this.options.platform === 'linux' ? [] : [format(t.location, state.commandPath)],
        ...selectedPath === undefined ? [] : [format(t.selected, selectedPath)],
        ...selected.unknown ? [t.unknown] : [],
      ].join('\n\n')
      if (this.options.platform === 'linux' || state.phase === 'unsupported'
        || state.phase === 'setup-required' || state.phase === 'unsupported-shell') {
        const message = this.options.platform === 'linux' ? t.linux : state.phase === 'unsupported' ? t.development
          : state.phase === 'setup-required' ? t.setup : t.shell
        await present({ type: 'info', message, detail: details, buttons: [t.close] })
        return
      }
      const repairable = state.phase === 'installed'
        || (state.phase === 'broken' && this.options.platform === 'darwin' && state.reason === 'launcher-missing')
      if (state.phase === 'broken' && !repairable) {
        await present({ type: 'warning', message: t.broken, detail: details, buttons: [t.close] })
        return
      }
      const choice = await present({
        type: other || state.phase === 'conflict' ? 'warning' : 'info',
        message: state.phase === 'installed' ? t.installed : state.phase === 'broken' ? t.broken : t.missing,
        detail: [details, ...other || state.phase === 'conflict' ? [t.conflict] : []].filter(Boolean).join('\n\n'),
        buttons: repairable ? [t.close, t.repair, t.remove] : [t.install, t.close],
        defaultId: 0, cancelId: repairable ? 0 : 1,
      })
      const operation = repairable ? choice.response === 1 ? 'install' : choice.response === 2 ? 'remove' : undefined
        : choice.response === 0 ? 'install' : undefined
      if (operation === undefined) return
      if (operation === 'install' && (other || selected.unknown || state.phase === 'conflict')) {
        const confirmation = await present({
          type: 'warning', message: t.conflict,
          detail: [details, ...selected.unknown ? [t.unknown] : []].filter(Boolean).join('\n\n'),
          buttons: [t.continue, t.close], defaultId: 1, cancelId: 1,
        })
        if (confirmation.response !== 0) return
      }
      const result = operation === 'remove' ? await this.options.manager.remove()
        : await this.options.manager.install(other || selected.unknown || state.phase === 'conflict')
      const success = operation === 'remove' ? result.phase === 'uninstalled' || result.phase === 'conflict'
        : result.phase === 'installed'
      const selectedAfter = operation === 'install' && success && this.options.platform === 'darwin'
        ? await (this.options.findCurrent?.() ?? findCurrentDshCommand(this.options.platform)) : undefined
      const stillShadowed = selectedAfter?.path !== undefined
        && normalizeCommand(selectedAfter.path) !== normalizeCommand(result.commandPath)
      await present({ type: success && !stillShadowed ? 'info' : 'warning',
        message: !success ? t.changed : operation === 'remove' ? t.removed : t.installed,
        detail: operation === 'install' && success
          ? [t.newTerminal, ...stillShadowed && selectedAfter.path !== undefined
            ? [format(t.selected, selectedAfter.path), t.conflict] : []].join('\n\n')
          : '', buttons: [t.close] })
    } catch (error) {
      await present({ type: 'error', message: t.failed,
        detail: error instanceof Error ? error.message : String(error), buttons: [t.close] })
    }
  }
}
