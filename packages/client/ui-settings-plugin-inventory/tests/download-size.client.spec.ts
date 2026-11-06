import { expect, it, vi } from 'vitest'
vi.mock('../src/client/download-size-data.ts', () => ({ downloadSizeData: { choices: {
  a: { targets: {
    mac: { downloadBytes: 2_000_000, additionalUnknown: false }, win: { downloadBytes: 4_000_000, additionalUnknown: false } } },
  b: { targets: {
    mac: { downloadBytes: 6_000_000, additionalUnknown: false }, win: { downloadBytes: 8_000_000, additionalUnknown: false } } },
  partial: { targets: { mac: { downloadBytes: 2_000_000, additionalUnknown: true } } },
  unknown: { targets: { mac: { downloadBytes: null, additionalUnknown: false } } },
} } }))
import { downloadSizeEstimate, formatDownloadSize } from '../src/client/download-size.ts'
it('averages every option and retains the supported-target range', () => {
  const estimate = downloadSizeEstimate(['a', 'b'])!
  expect(estimate).toEqual({ minimum: 4_000_000, maximum: 6_000_000, additionalUnknown: false })
  expect(formatDownloadSize(estimate)).toBe('4.0–6.0 MB')
})
it('does not average away missing choices or measurements', () => {
  expect(downloadSizeEstimate(['a', 'unknown'])).toBeUndefined()
  expect(downloadSizeEstimate(['a', 'missing'])).toBeUndefined()
  expect(downloadSizeEstimate([])).toBeUndefined()
})
it('presents incomplete runtime downloads as a lower bound', () => {
  expect(formatDownloadSize(downloadSizeEstimate(['partial'])!)).toBe('≥ 2.0 MB')
})

it('counts preinstalled choices as zero while preserving the other option in the average', () => {
  expect(downloadSizeEstimate(['a', 'b'], ['a'])).toEqual({ minimum: 3_000_000, maximum: 4_000_000, additionalUnknown: false })
})
