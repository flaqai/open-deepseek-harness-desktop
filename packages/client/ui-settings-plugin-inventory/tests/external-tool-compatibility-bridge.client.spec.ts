import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveExternalToolInstallRequest } from '../src/client/external-tool-compatibility-bridge.ts'

afterEach(() => {
  delete (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop
})

describe('external tool compatibility bridge', () => {
  it.each([
    ['browser-use-playwright', 'browser-use-playwright-mcp'],
    ['browser-use-devtools', 'browser-use-chrome-devtools-mcp'],
    ['computer-use-native', 'computer-use-cua-driver-native'],
    ['computer-use-mcp', 'computer-use-cua-driver-mcp'],
    ['browser-use-stagehand', 'browser-use-stagehand-native'],
    ['auto-review', 'auto-review'],
  ] as const)('keeps the %s selection compatible with its source provider version', async (toolId, directory) => {
    const manifest: unknown = JSON.parse(readFileSync(new URL(`../../../experimental/${directory}/package.json`, import.meta.url), 'utf8'))
    if (typeof manifest !== 'object' || manifest === null || !('name' in manifest) || typeof manifest.name !== 'string'
      || !('version' in manifest) || typeof manifest.version !== 'string') throw new Error('invalid provider manifest')
    const request = await resolveExternalToolInstallRequest(toolId)
    expect(request.packageSpec).toBe(`${manifest.name}@${manifest.version}`)
  })

  it('asks desktop main to resolve a closed tool id', async () => {
    const resolve = vi.fn(async () => ({
      toolId: 'codex' as const,
      packageSpec: '@deepseek-ai/dsh-subagent-codex@0.1.7-rc.2',
    }))
    ;(globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop = {
      externalTools: { resolve },
    }

    await expect(resolveExternalToolInstallRequest('codex')).resolves.toEqual({
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-subagent-codex@0.1.7-rc.2',
    })
    expect(resolve).toHaveBeenCalledWith('codex')
  })

  it('uses the exact embedded browser fallback without a desktop bridge', async () => {
    await expect(resolveExternalToolInstallRequest('claude-code')).resolves.toEqual({
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-subagent-claude-code@0.2.2-rc.4',
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

  it('resolves Auto review to the reviewed rc.4 bundle', async () => {
    await expect(resolveExternalToolInstallRequest('auto-review')).resolves.toEqual({
      profile: 'web',
      packageSpec: '@deepseek-ai/dsh-experimental-auto-review@0.2.2-rc.4',
    })
  })

  it.each([
    ['browser-use-playwright', '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.2.2-rc.4'],
    ['browser-use-devtools', '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp@0.2.2-rc.4'],
    ['browser-use-stagehand', '@deepseek-ai/dsh-experimental-browser-use-stagehand-native@0.2.2-rc.4'],
    ['computer-use-native', '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native@0.2.2-rc.4'],
    ['computer-use-mcp', '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp@0.2.2-rc.4'],
  ] as const)('resolves %s to its reviewed provider version', async (toolId, packageSpec) => {
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
      packageSpec: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.2.2-rc.4',
      experimentalCapability: 'browser-use-playwright-visible',
    })
  })
})
