// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { McpSettings, type McpSettingsProps } from '../src/client/McpSettings.tsx'
import { en, type McpLocaleKey } from '../src/client/locales.ts'
import type { McpServerView } from '../src/types.ts'

afterEach(cleanup)
const row: McpServerView = { id: 'mcp-demo', serverName: 'demo', transport: 'stdio', config: { serverName: 'demo', transport: 'stdio', command: 'demo-command', env: { KEY: 'private-token' } }, enabled: true, source: 'profile', editable: true }
function props(rows: McpServerView[] = []): McpSettingsProps {
  return { t: (key: McpLocaleKey) => en[key], list: vi.fn().mockResolvedValue(rows), upsert: vi.fn().mockResolvedValue({ application: 'restart-required', servers: rows }), remove: vi.fn().mockResolvedValue({ application: 'applied', servers: [] }), setEnabled: vi.fn().mockResolvedValue({ application: 'applied', servers: rows }), getTools: vi.fn().mockResolvedValue([]) } as McpSettingsProps
}
it('adds a local service and reports restart-required without pretending it is connected', async () => {
  const face = props()
  render(<McpSettings {...face} />)
  expect(await screen.findByText(en.empty)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.add }))
  fireEvent.change(screen.getByLabelText(en.name), { target: { value: 'demo' } })
  fireEvent.change(screen.getByLabelText(en.command), { target: { value: 'demo-command' } })
  fireEvent.click(screen.getByRole('button', { name: en.save }))
  expect(await screen.findByText(en.restart)).toBeTruthy()
  expect(face.upsert).toHaveBeenCalledWith(expect.objectContaining({ serverName: 'demo', command: 'demo-command', transport: 'stdio' }))
})
it('hides credentials unless explicitly requested and preserves existing parameters', async () => {
  const face = props([row])
  render(<McpSettings {...face} />)
  await screen.findByText('demo')
  fireEvent.click(screen.getByRole('button', { name: en.edit }))
  expect(screen.queryByDisplayValue(/private-token/u)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.save }))
  await waitFor(() => { expect(face.upsert).toHaveBeenCalledWith(expect.objectContaining({ env: row.config.env })) })
})
it('does not classify zero-tool services as healthy or failed and confirms removal', async () => {
  const face = props([row])
  render(<McpSettings {...face} />)
  await screen.findByText('demo')
  fireEvent.click(screen.getByRole('button', { name: en.tools }))
  expect(await screen.findByText(en.noTools)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.remove }))
  expect(face.remove).not.toHaveBeenCalled()
  fireEvent.click(screen.getAllByRole('button', { name: en.remove })[1]!)
  await waitFor(() => { expect(face.remove).toHaveBeenCalledWith('demo') })
})
it('shows a retryable error when profile access is refused', async () => {
  const face = props()
  vi.mocked(face.list).mockRejectedValue(new Error('forbidden'))
  render(<McpSettings {...face} />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByRole('button', { name: en.retry })).toBeTruthy()
})
it('preserves an existing timeout and rejects nonpositive timeout edits', async () => {
  const face = props([{ ...row, config: { ...row.config, toolCallTimeoutMs: 300_000 } }])
  render(<McpSettings {...face} />)
  await screen.findByText('demo')
  fireEvent.click(screen.getByRole('button', { name: en.edit }))
  expect(screen.getByLabelText(en.timeout).getAttribute('value')).toBe('300000')
  fireEvent.change(screen.getByLabelText(en.timeout), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: en.save }))
  expect(screen.getByRole('alert').textContent).toBe(en.invalid)
  expect(face.upsert).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText(en.timeout), { target: { value: '600000' } })
  fireEvent.click(screen.getByRole('button', { name: en.save }))
  await waitFor(() => { expect(face.upsert).toHaveBeenCalledWith(expect.objectContaining({ toolCallTimeoutMs: 600_000 })) })
})
