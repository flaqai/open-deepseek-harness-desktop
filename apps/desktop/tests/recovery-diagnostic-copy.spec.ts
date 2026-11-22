import { describe, expect, it, vi } from 'vitest'
import { copyRecoveryDiagnostic } from '../src/recovery-diagnostic-copy.ts'

function fixture() {
  const sender = {}; const mainFrame = {}
  const url = 'file:///C:/Program%20Files/OpenDSH/loading.html?state=failed'
  return {
    request: { sender, frame: mainFrame, url },
    owner: { sender, mainFrame, loadingUrl: 'file:///C:/Program%20Files/OpenDSH/loading.html', local: true },
  }
}

describe('native recovery diagnostic copying', () => {
  it('copies main-owned redacted text without browser clipboard permission', async () => {
    const { request, owner } = fixture(); const write = vi.fn()
    await copyRecoveryDiagnostic(request, owner, () => ({
      text: 'Failure at C:/private/profile token=credential Authorization: Bearer private-value\n' + 'x'.repeat(10_000),
      home: 'C:/private/profile',
    }), write)
    expect(write).toHaveBeenCalledOnce()
    const text = write.mock.calls[0]?.[0] as string
    expect(text).toContain('Failure at <dsh-home> token=<redacted>')
    expect(text).not.toContain('credential')
    expect(text).not.toContain('private-value')
    expect(text.length).toBe(8_192)
  })

  it.each(['renderer', 'iframe', 'missing-frame', 'page', 'web-page', 'nas'])('rejects %s before reading diagnostic text', async (kind) => {
    const { request, owner } = fixture(); const read = vi.fn(() => ({ text: 'failure' })); const write = vi.fn()
    const changed = {
      ...request,
      ...(kind === 'renderer' ? { sender: {} } : {}),
      ...(kind === 'iframe' ? { frame: {} } : {}),
      ...(kind === 'missing-frame' ? { frame: null } : {}),
      ...(kind === 'page' ? { url: 'file:///C:/Program%20Files/OpenDSH/other.html' } : {}),
      ...(kind === 'web-page' ? { url: 'http://127.0.0.1:43210/' } : {}),
    }
    await expect(copyRecoveryDiagnostic(changed, { ...owner, local: kind !== 'nas' }, read, write)).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('waits for native completion and reports asynchronous clipboard rejection', async () => {
    const { request, owner } = fixture()
    const write = vi.fn().mockRejectedValue(new Error('asynchronous clipboard failure'))
    await expect(copyRecoveryDiagnostic(request, owner, () => ({ text: 'failure' }), write))
      .rejects.toThrow('asynchronous clipboard failure')
    expect(write).toHaveBeenCalledOnce()
    const success = vi.fn().mockResolvedValue(undefined)
    await expect(copyRecoveryDiagnostic(request, owner, () => ({ text: 'failure' }), success)).resolves.toBeUndefined()
  })

  it('reports native clipboard errors and rejects empty diagnostics', async () => {
    const { request, owner } = fixture()
    await expect(copyRecoveryDiagnostic(request, owner, () => ({ text: 'failure' }), () => {
      throw new Error('clipboard unavailable')
    })).rejects.toThrow('clipboard unavailable')
    const write = vi.fn()
    await expect(copyRecoveryDiagnostic(request, owner, () => ({ text: '  ' }), write)).rejects.toThrow('no recovery diagnostic')
    expect(write).not.toHaveBeenCalled()
  })
})
