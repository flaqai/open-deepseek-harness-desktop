import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveExternalToolInstallRequest } from '../src/client/external-tool-compatibility-bridge.ts'

afterEach(() => {
  delete (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop
})

describe('external tool compatibility bridge', () => {
  it('asks desktop main to resolve a closed tool id', async () => {
    const resolve = vi.fn(async () => ({
      toolId: 'codex' as const,
      packageSpec: '@deepseek-ai/dsh-subagent-codex@0.1.7-rc.1',
    }))
    ;(globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop = {
      externalTools: { resolve },
    }

    await expect(resolveExternalToolInstallRequest('codex')).resolves.toEqual({
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-subagent-codex@0.1.7-rc.1',
    })
    expect(resolve).toHaveBeenCalledWith('codex')
  })

  it('uses the exact embedded browser fallback without a desktop bridge', async () => {
    await expect(resolveExternalToolInstallRequest('claude-code')).resolves.toEqual({
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-subagent-claude-code@0.1.7-rc.1',
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

  it('resolves Auto review to the reviewed rc.1 bundle', async () => {
    await expect(resolveExternalToolInstallRequest('auto-review')).resolves.toEqual({
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-experimental-auto-review@0.1.7-rc.1',
    })
  })

  it.each([
    ['browser-use-playwright', '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.1.7-rc.1'],
    ['browser-use-devtools', '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp@0.1.7-rc.1'],
    ['browser-use-stagehand', '@deepseek-ai/dsh-experimental-browser-use-stagehand-native@0.1.7-rc.1'],
    ['computer-use-native', '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native@0.1.7-rc.1'],
    ['computer-use-mcp', '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp@0.1.7-rc.1'],
  ] as const)('resolves %s to its reviewed rc.1 provider', async (toolId, packageSpec) => {
    await expect(resolveExternalToolInstallRequest(toolId)).resolves.toEqual({
      profile: 'web',
      packageSpec,
    })
  })

  it('adds only the fixed composition recipe selected by the capability UI', async () => {
    await expect(resolveExternalToolInstallRequest(
      'browser-use-playwright',
      'browser-use-playwright-visible',
    )).resolves.toEqual({
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.1.7-rc.1',
      experimentalCapability: 'browser-use-playwright-visible',
    })
  })
})
