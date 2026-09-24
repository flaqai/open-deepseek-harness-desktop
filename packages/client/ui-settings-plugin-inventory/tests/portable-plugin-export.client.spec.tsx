// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortablePluginExport } from '../src/client/PortablePluginExport.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

const bridge = vi.hoisted(() => ({ inspect: vi.fn(), exportBundle: vi.fn() }))
vi.mock('../src/client/imported-restore-bridge.ts', () => ({
  readImportedPluginRestoreBridge: () => ({ inspectExport: bridge.inspect, exportBundle: bridge.exportBundle }),
}))

const t = (key: PluginInventoryLocaleKey): string => en[key]

beforeEach(() => { bridge.inspect.mockReset(); bridge.exportBundle.mockReset() })
afterEach(cleanup)

describe('portable plugin export panel', () => {
  it('loads installed candidates and sends selected exact packages with the target OS version', async () => {
    bridge.inspect.mockResolvedValue({
      selectionId: '12345678-1234-4234-8234-123456789abc',
      host: { platform: 'darwin', architecture: 'arm64', osVersion: '24.6.0' },
      candidates: [
        { packageName: 'first-plugin', version: '1.2.3' },
        { packageName: 'second-plugin', version: '4.5.6' },
      ],
      omitted: [{ packageName: 'custom-plugin', reason: 'custom-source' }],
    })
    bridge.exportBundle.mockResolvedValue({ status: 'saved' })
    render(<PortablePluginExport t={t} />)
    fireEvent.click(screen.getByRole('button', { name: en['portableExport.source'] }))
    expect(await screen.findByText('first-plugin@1.2.3')).toBeTruthy()
    expect(screen.getByText('second-plugin@4.5.6')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('second-plugin@4.5.6'))
    fireEvent.change(screen.getByLabelText(en['portableExport.platform']), { target: { value: 'win32' } })
    fireEvent.change(screen.getByLabelText(en['portableExport.version']), { target: { value: '10.0.22631' } })
    fireEvent.click(screen.getByRole('button', { name: en['portableExport.prepare'] }))
    await waitFor(() => { expect(bridge.exportBundle).toHaveBeenCalledExactlyOnceWith({
      selectionId: '12345678-1234-4234-8234-123456789abc',
      target: { platform: 'win32', architecture: 'arm64', osVersion: '10.0.22631' },
      packageNames: ['first-plugin'],
    }) })
    expect(await screen.findByText(en['portableExport.saved'])).toBeTruthy()
  })

  it('does not export without candidates or a valid destination OS version', async () => {
    bridge.inspect.mockResolvedValue({
      selectionId: '12345678-1234-4234-8234-123456789abc',
      host: { platform: 'linux', architecture: 'x64', osVersion: '6.8.0' },
      candidates: [{ packageName: 'example-plugin', version: '1.0.0' }], omitted: [],
    })
    render(<PortablePluginExport t={t} />)
    fireEvent.click(screen.getByRole('button', { name: en['portableExport.source'] }))
    expect(await screen.findByText('example-plugin@1.0.0')).toBeTruthy()
    const prepare = screen.getByRole('button', { name: en['portableExport.prepare'] })
    fireEvent.change(screen.getByLabelText(en['portableExport.version']), { target: { value: '../invalid' } })
    expect(prepare.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText(en['portableExport.version']), { target: { value: '6.8.0' } })
    fireEvent.click(screen.getByLabelText('example-plugin@1.0.0'))
    expect(prepare.hasAttribute('disabled')).toBe(true)
    expect(bridge.exportBundle).not.toHaveBeenCalled()
  })
})
