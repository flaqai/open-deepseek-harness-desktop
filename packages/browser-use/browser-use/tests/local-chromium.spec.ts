import { accessSync, statSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { localChromiumCandidates, resolveLocalChromiumExecutable } from '../src/local-chromium.ts'
vi.mock('node:fs', () => ({ accessSync: vi.fn(), statSync: vi.fn(), constants: { F_OK: 0, X_OK: 1 } }))
afterEach(() => { vi.resetAllMocks() })
it('uses an accessible explicit browser without discovery', () => {
  vi.mocked(statSync).mockReturnValue({ isFile: () => true } as ReturnType<typeof statSync>)
  expect(resolveLocalChromiumExecutable('/installed/chrome')).toBe('/installed/chrome')
  expect(accessSync).toHaveBeenCalledOnce()
})
it('rejects a missing explicit browser instead of selecting another one', () => {
  vi.mocked(statSync).mockImplementation(() => { throw new Error('missing') })
  expect(() => resolveLocalChromiumExecutable('/missing/chrome')).toThrow('Select an installed Chrome or Chromium')
  expect(statSync).toHaveBeenCalledTimes(1)
})
it('explains a missing browser without downloading anything', () => {
  vi.mocked(statSync).mockImplementation(() => { throw new Error('missing') })
  expect(() => resolveLocalChromiumExecutable()).toThrow('Install Chrome or Chromium')
  expect(accessSync).not.toHaveBeenCalled()
})
it('includes standard system, user and PATH locations for each desktop platform', () => {
  expect(localChromiumCandidates('darwin', { PATH: '/custom/bin' }, '/Users/test')).toContain('/Users/test/Applications/Chromium.app/Contents/MacOS/Chromium')
  expect(localChromiumCandidates('win32', { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' }, 'C:\\Users\\test'))
    .toContain('C:\\Users\\test\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
  expect(localChromiumCandidates('linux', { PATH: '/custom/bin' }, '/home/test')).toContain('/custom/bin/chromium')
})
