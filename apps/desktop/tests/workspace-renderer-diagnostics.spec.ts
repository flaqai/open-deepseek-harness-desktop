import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { installWorkspaceRendererDiagnostics } from '../src/workspace-renderer-diagnostics.ts'

function setup() {
  const renderer = Object.assign(new EventEmitter(), { mainFrame: {} })
  const append = vi.fn()
  const trusted = vi.fn(() => true)
  let time = 0
  const dispose = installWorkspaceRendererDiagnostics(renderer, trusted, append, () => time)
  const emit = (changes: Record<string, unknown> = {}) => renderer.emit('console-message', {
    level: 'error', frame: renderer.mainFrame,
    message: "slot entry crashed in 'sidebar.workspaces': TypeError: failed at http://localhost/client.js?token=private-value",
    lineNumber: 42, sourceId: 'http://localhost/assets/client.js?token=other-private-value',
    ...changes,
  })
  return { renderer, append, trusted, emit, dispose, advance: () => { time += 60_000 } }
}

describe('workspace renderer diagnostics', () => {
  it('retains a redacted, bounded workspace error from the trusted main frame', () => {
    const h = setup()
    h.emit()
    expect(h.append).toHaveBeenCalledOnce()
    const message = h.append.mock.calls[0]?.[0] as string
    expect(message).toContain("slot entry crashed in 'sidebar.workspaces'")
    expect(message).toContain('client.js:42')
    expect(message).not.toContain('private-value')
    expect(message).not.toContain('other-private-value')
    h.emit({ message: "slot entry crashed in 'sidebar.workspaces': " + 'x'.repeat(30_000) })
    expect((h.append.mock.calls[1]?.[0] as string).length).toBeLessThan(6_500)
    h.dispose()
  })

  it('excludes unrelated console output, untrusted navigation and guest frames', () => {
    const h = setup()
    h.emit({ message: 'private chat content' })
    h.emit({ level: 'warning' })
    h.emit({ frame: {} })
    h.trusted.mockReturnValue(false)
    h.emit()
    expect(h.append).not.toHaveBeenCalled()
    h.trusted.mockReturnValue(true)
    h.emit()
    expect(h.append).toHaveBeenCalledOnce()
    h.dispose()
    h.emit()
    expect(h.append).toHaveBeenCalledOnce()
  })

  it('bounds error bursts and tolerates a failed diagnostic sink', () => {
    const h = setup()
    for (let i = 0; i < 30; i++) h.emit()
    expect(h.append).toHaveBeenCalledTimes(10)
    h.advance()
    h.append.mockImplementation(() => { throw new Error('disk full') })
    expect(() => h.emit({ sourceId: 'not a URL' })).not.toThrow()
    expect(h.append).toHaveBeenCalledTimes(11)
    h.dispose()
  })
})
