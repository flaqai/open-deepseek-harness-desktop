import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isPackagedRuntimeReady } from '../src/packaged-runtime.ts'

async function createRuntime(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-packaged-runtime-'))
  await mkdir(join(root, 'lib'), { recursive: true })
  await mkdir(join(root, 'node_modules', '@deepseek-ai', 'cosmokit'), { recursive: true })
  await mkdir(join(root, 'package-runtime', 'bin'), { recursive: true })
  await writeFile(join(root, 'lib', 'bin.js'), '')
  await writeFile(join(root, 'package-runtime', 'bin', 'node'), '')
  await writeFile(join(root, 'package-runtime', 'bin', 'pnpm'), '')
  return root
}

describe('packaged desktop runtime', () => {
  it('rejects an extracted cache from the old incomplete layout', async () => {
    const runtime = await createRuntime()
    expect(await isPackagedRuntimeReady(runtime)).toBe(false)
  })

  it('accepts a complete versioned runtime layout', async () => {
    const runtime = await createRuntime()
    await writeFile(join(runtime, '.desktop-runtime-v3'), '@deepseek-ai/dsh@0.1.0-rc.5\n')
    expect(await isPackagedRuntimeReady(runtime)).toBe(true)
  })
})
