import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as workspaceRuntime from '../src/index.ts'
import { readWorkspaceRuntimePayload, resolveWorkspaceDependencies } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture(): Promise<{ root: string; node: string; pnpm: string; nodePackages: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-host-workspace-runtime-'))
  roots.push(root)
  const pythonRoot = join(root, 'python')
  const python = process.platform === 'win32' ? join(pythonRoot, 'python.exe') : join(pythonRoot, 'bin', 'python3')
  const packages = process.platform === 'win32'
    ? join(pythonRoot, 'Lib', 'site-packages')
    : join(pythonRoot, 'lib', 'python3.12', 'site-packages')
  const node = join(root, 'tools', process.platform === 'win32' ? 'node.exe' : 'node')
  const pnpm = join(root, 'tools', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  const nodePackages = join(root, 'node_modules')
  await Promise.all([
    mkdir(join(python, '..'), { recursive: true }), mkdir(packages, { recursive: true }),
    mkdir(join(node, '..'), { recursive: true }), mkdir(nodePackages, { recursive: true }),
  ])
  await Promise.all([
    writeFile(python, ''), writeFile(node, ''), writeFile(pnpm, ''),
    writeFile(join(root, 'runtime.json'), JSON.stringify({
      schema: 'dsh/workspace-runtime-payload/v1', desktopVersion: '0.1.6-alpha.2.1',
      platform: process.platform, arch: process.arch, payloadDigest: 'a'.repeat(64),
      pythonVersion: '3.12.14', pythonPackages: { numpy: '2.3.3', 'python-docx': '1.2.0' },
    })),
  ])
  return { root, node, pnpm, nodePackages }
}

describe('host workspace-runtime adapter', () => {
  it('uses trusted custom Python paths without managed payload metadata', async () => {
    const value = await fixture()
    const python = join(value.root, 'custom-python')
    const sitePackages = join(value.root, 'custom-site-packages')
    await Promise.all([writeFile(python, ''), mkdir(sitePackages)])
    await expect(resolveWorkspaceDependencies({
      runtimeRoot: value.root, python, pythonPackages: sitePackages,
      pythonDistributions: { openpyxl: '3.1.5' }, node: value.node, pnpm: value.pnpm,
      nodePackages: value.nodePackages,
    })).resolves.toMatchObject({ python, pythonPackages: sitePackages, pythonDistributions: { openpyxl: '3.1.5' } })
  })

  it('validates payload identity and resolves only application-owned absolute paths', async () => {
    const value = await fixture()
    await expect(readWorkspaceRuntimePayload(value.root)).resolves.toMatchObject({
      platform: process.platform, arch: process.arch, pythonVersion: '3.12.14',
    })
    await expect(resolveWorkspaceDependencies({
      runtimeRoot: value.root, node: value.node, pnpm: value.pnpm, nodePackages: value.nodePackages,
    })).resolves.toMatchObject({
      node: value.node, pnpm: value.pnpm, nodePackages: value.nodePackages,
      pythonDistributions: { numpy: '2.3.3', 'python-docx': '1.2.0' },
    })
  })

  it('rejects normalized duplicate distribution names', async () => {
    const value = await fixture()
    await writeFile(join(value.root, 'runtime.json'), JSON.stringify({
      schema: 'dsh/workspace-runtime-payload/v1', desktopVersion: '0.1.6-alpha.2.1',
      platform: process.platform, arch: process.arch, payloadDigest: 'a'.repeat(64),
      pythonVersion: '3.12.14', pythonPackages: { 'python-docx': '1.2.0', python_docx: '1.2.0' },
    }))
    await expect(readWorkspaceRuntimePayload(value.root)).rejects.toThrow(/duplicate normalized/u)
  })

  it('mounts and disposes the real Office composition through the Loader', async () => {
    const value = await fixture()
    const ctx = new Context()
    try {
      ctx.baseUrl = pathToFileURL(value.root).href + '/'
      await ctx.plugin(Loader)
      ctx.loader.builtins.include = Include
      const modules = new Map<string, unknown>([
        ['agents', AgentRegistry], ['systemPrompt', SystemPrompt], ['tools', ToolRuntime],
        ['skills', SkillRegistry], ['workspace-runtime', workspaceRuntime],
      ])
      const unexpected = (): never => { throw new Error('unexpected internal loader operation') }
      ctx.loader.internal = {
        version: 'v2',
        loadCache: new Map(),
        async import(specifier: string) {
          if (!modules.has(specifier)) throw new Error(`unexpected plugin ${specifier}`)
          return modules.get(specifier)
        },
        register: unexpected,
        getOrCreateModuleJob: unexpected,
        resolveSync: unexpected,
        load: unexpected,
      }
      const config = join(value.root, 'cordis.yml')
      await writeFile(config, [
        '- name: agents', '- name: systemPrompt', '- name: tools', '- name: skills',
        '- name: workspace-runtime', '  config:', `    runtimeRoot: ${JSON.stringify(value.root)}`,
        `    node: ${JSON.stringify(value.node)}`, `    pnpm: ${JSON.stringify(value.pnpm)}`,
        `    nodePackages: ${JSON.stringify(value.nodePackages)}`, '    office: true', '',
      ].join('\n'))
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
      await ctx.loader.await()
      for (const entry of ctx.loader.entries()) await entry.fiber?.await()
      expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['office-docx', 'office-pptx', 'office-xlsx'])
      expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(['load_workspace_dependencies'])
      const entry = [...ctx.loader.entries()].find(entry => entry.options.name === 'workspace-runtime')
      await entry?.fiber?.dispose()
      expect(await ctx.skills.list()).toEqual([])
      expect(ctx.tools.schemas()).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
