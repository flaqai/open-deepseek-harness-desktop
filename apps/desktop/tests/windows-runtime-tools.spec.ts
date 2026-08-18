import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureWindowsRuntimeTools } from '../src/windows-runtime-tools.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('Windows runtime tools', () => {
  it('writes Electron-as-Node and embedded-pnpm command shims', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-windows-tools-'))
    roots.push(root)
    const tools = await ensureWindowsRuntimeTools(root, 'C:\\DeepSeek Harness.exe', 'C:\\resources\\pnpm.mjs')
    expect(await readFile(tools.nodeCommand, 'utf8')).toContain('"C:\\DeepSeek Harness.exe" --expose-internals %*')
    expect(await readFile(tools.packageManagerBin, 'utf8')).toContain('"C:\\resources\\pnpm.mjs" %*')
  })
})
