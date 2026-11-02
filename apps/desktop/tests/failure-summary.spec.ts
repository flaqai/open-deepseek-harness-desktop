import { expect, it } from 'vitest'
import { summarizeFailure } from '../src/failure-summary.ts'

it('retains the failed module and cause ahead of a long dependency cascade', () => {
  const error = `startup failed\nFailed plugins (1):\nwebserver\nError: EACCES\n\nPlugins waiting for services (100):\n${'connection webRuntime\n'.repeat(100)}`
  expect(summarizeFailure(error)).toContain('Error: EACCES')
  expect(summarizeFailure(error)).not.toContain('connection webRuntime')
})
it('bounds unstructured diagnostics while preserving both ends', () => {
  const result = summarizeFailure(`original cause ${'x'.repeat(4000)} final error`, 100)
  expect(result.length).toBeLessThanOrEqual(100)
  expect(result).toMatch(/^original cause/)
  expect(result).toMatch(/final error$/)
  expect(summarizeFailure('simple error')).toBe('simple error')
})
