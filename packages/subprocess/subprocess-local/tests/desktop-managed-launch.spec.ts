/** Desktop launches retain literal argv options and their selected private runner. */
import { afterEach, expect, it, vi } from 'vitest'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { launchDesktopManagedProcess } from '../src/process-control.ts'
import * as linux from '../src/linux-scope.ts'
import * as windows from '../src/windows-job.ts'
import * as processSpawn from '../src/spawn.ts'
import type { RunnerInvocation } from '../src/runner-launch.ts'

afterEach(() => { vi.restoreAllMocks() })

const runner: RunnerInvocation = [process.execPath, '/packaged/runtime/runner.js']
const spec: SubprocessSpawnSpec = {
  argv: [process.execPath, '-e', ''], cwd: process.cwd(),
  stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }, graceMs: 100,
}

it.each([['--expand-environment=no'], []])('passes probed Linux literal argv options %j and the packaged runner separately', (...options) => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  const probe = vi.spyOn(linux, 'probeLinuxNative').mockReturnValue(options)
  const stop = new Error('launch inspected')
  const launch = vi.spyOn(linux, 'launchLinuxScope').mockImplementation(() => { throw stop })
  expect(() => launchDesktopManagedProcess(spec, runner)).toThrow(stop)
  expect(probe).toHaveBeenCalledExactlyOnceWith({ runnerInvocation: runner })
  expect(launch).toHaveBeenCalledExactlyOnceWith(spec, expect.any(Object), options, { runnerInvocation: runner })
})

it('uses ordinary process ownership only when the Linux native probe is unavailable', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  vi.spyOn(linux, 'probeLinuxNative').mockReturnValue(undefined)
  const native = vi.spyOn(linux, 'launchLinuxScope')
  const stop = new Error('fallback inspected')
  const fallback = vi.spyOn(processSpawn, 'spawnSubprocess').mockImplementation(() => { throw stop })
  expect(() => launchDesktopManagedProcess(spec, runner)).toThrow(stop)
  expect(fallback).toHaveBeenCalledExactlyOnceWith(spec)
  expect(native).not.toHaveBeenCalled()
})

it.each(['client', 'task'] as const)('retains the Windows %s lifecycle breakaway policy', (lifecycle) => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.spyOn(windows, 'probeWindowsJob').mockReturnValue(true)
  const stop = new Error('Windows launch inspected')
  const launch = vi.spyOn(windows, 'launchWindowsJob').mockImplementation(() => { throw stop })
  const request = { ...spec, lifecycle }
  expect(() => launchDesktopManagedProcess(request, runner)).toThrow(stop)
  expect(launch).toHaveBeenCalledExactlyOnceWith(request, expect.any(Object), {
    runnerInvocation: runner,
    ...lifecycle === 'client' ? { allowChildBreakaway: true } : {},
  })
})
