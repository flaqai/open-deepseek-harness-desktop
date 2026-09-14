import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveExternalToolInstallRequest } from '../src/client/external-tool-compatibility-bridge.ts'

afterEach(() => {
  delete (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop
})

describe('external tool compatibility bridge', () => {
  it('asks desktop main to resolve a closed tool id', async () => {
    const resolve = vi.fn(async () => ({
      toolId: 'codex' as const,
      packageSpec: '@deepseek-ai/dsh-subagent-codex@0.1.5-rc.2',
    }))
    ;(globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop = {
      externalTools: { resolve },
    }

    await expect(resolveExternalToolInstallRequest('codex')).resolves.toEqual({
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-subagent-codex@0.1.5-rc.2',
    })
    expect(resolve).toHaveBeenCalledWith('codex')
  })

  it('uses the exact embedded browser fallback without a desktop bridge', async () => {
    await expect(resolveExternalToolInstallRequest('claude-code')).resolves.toEqual({
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-subagent-claude-code@0.1.5-rc.2',
    })
  })

  it('keeps the reviewed WorkBuddy community connector on the network Host path', async () => {
    const resolve = vi.fn()
    ;(globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop = {
      externalTools: { resolve },
    }

    await expect(resolveExternalToolInstallRequest('workbuddy')).resolves.toEqual({
      profile: 'web',
      packageSpec: 'dsh-workbuddy-connect@0.5.0',
    })
    expect(resolve).not.toHaveBeenCalled()
  })
})
