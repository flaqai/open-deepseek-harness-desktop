import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopQuitConfirmation, resolveDesktopQuitPrompt, type DesktopQuitInspection } from '../src/quit-confirmation.ts'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

function setup(inspect: () => Promise<DesktopQuitInspection> | undefined, platform: NodeJS.Platform = 'darwin') {
  const shown: MessageBoxOptions[] = []
  const focus = vi.fn()
  const show = vi.fn(async (options: MessageBoxOptions): Promise<MessageBoxReturnValue> => {
    shown.push(options)
    return { response: 0, checkboxChecked: false }
  })
  const confirmation = new DesktopQuitConfirmation({ inspect, show, locale: () => 'zh-CN', focus, platform })
  return { confirmation, shown, focus, show }
}

describe('desktop quit confirmation', () => {
  it.each([
    [{ activeTasks: false, scheduledTasks: false }, undefined],
    [{ activeTasks: true, scheduledTasks: false }, 'active'],
    [{ activeTasks: false, scheduledTasks: true }, 'scheduled'],
    [{ activeTasks: true, scheduledTasks: true }, 'both'],
    ['unknown', 'unknown'],
  ] as const)('selects a warning for %j', (result, expected) => {
    expect(resolveDesktopQuitPrompt(result)).toBe(expected)
  })

  it('quits silently only after a known idle answer or before Host startup', async () => {
    const idle = setup(async () => ({ activeTasks: false, scheduledTasks: false }))
    const starting = setup(() => undefined)
    expect(await idle.confirmation.confirm()).toBe(true)
    expect(await starting.confirmation.confirm()).toBe(true)
    expect([...idle.shown, ...starting.shown]).toEqual([])
  })

  it('warns about active and scheduled work with localized, native copy', async () => {
    const f = setup(async () => ({ activeTasks: true, scheduledTasks: true }))
    expect(await f.confirmation.confirm()).toBe(true)
    expect(f.shown).toEqual([expect.objectContaining({
      type: 'warning', message: '退出 Open DeepSeek Harness Desktop？',
      detail: '当前正在运行的任务将会中断，且应用关闭期间，定时任务不会运行。',
      buttons: ['退出', '取消'], defaultId: 1, cancelId: 1,
    })])
  })

  it('keeps Windows task dialog unowned and treats Cancel as refusal', async () => {
    const f = setup(async () => ({ activeTasks: false, scheduledTasks: true }), 'win32')
    f.show.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    expect(await f.confirmation.confirm()).toBe(false)
    expect(f.show.mock.calls[0]?.[0]).toMatchObject({
      type: 'none', detail: '应用关闭期间，定时任务不会运行。',
      buttons: ['退出', '取消'], defaultId: 1, cancelId: 1, noLink: true,
    })
  })

  it('warns when inspection rejects or times out instead of silently quitting', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failed = setup(async () => { throw new Error('offline') })
    failed.show.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    expect(await failed.confirmation.confirm()).toBe(false)
    expect(failed.show.mock.calls[0]?.[0].detail).toBe('无法确认本机是否有运行中的任务；退出可能中断任务。')

    vi.useFakeTimers()
    const stalled = setup(() => new Promise(() => {}))
    stalled.show.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    const result = stalled.confirmation.confirm()
    await vi.advanceTimersByTimeAsync(2000)
    expect(await result).toBe(false)
    expect(stalled.show.mock.calls[0]?.[0].detail).toBe('无法确认本机是否有运行中的任务；退出可能中断任务。')
    expect(console.warn).toHaveBeenCalledTimes(2)
  })

  it('joins repeated requests and ignores a stale answer after a restart supersedes it', async () => {
    const inspected = Promise.withResolvers<DesktopQuitInspection>()
    const inspect = vi.fn(() => inspected.promise)
    const f = setup(inspect)
    const first = f.confirmation.confirm()
    expect(f.confirmation.confirm()).toBe(first)
    expect(f.focus).toHaveBeenCalledOnce()
    expect(inspect).toHaveBeenCalledOnce()
    f.confirmation.cancelPending()
    inspected.resolve({ activeTasks: true, scheduledTasks: false })
    expect(await first).toBe(false)
    expect(f.shown).toEqual([])
  })

  it('does not turn a failed native dialog into an implicit approval', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = setup(async () => ({ activeTasks: true, scheduledTasks: false }))
    f.show.mockRejectedValueOnce(new Error('dialog unavailable'))
    expect(await f.confirmation.confirm()).toBe(false)
  })
})
