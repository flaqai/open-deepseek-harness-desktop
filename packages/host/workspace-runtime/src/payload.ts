/** Read and validate application-owned runtime payload metadata and paths. */
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Config, WorkspaceDependencies, WorkspaceRuntimePayloadManifest } from './index.ts'

function requireString(record: Record<string, unknown>, key: string, pattern?: RegExp): string {
  const value = record[key]
  if (typeof value !== 'string' || value === '' || (pattern !== undefined && !pattern.test(value))) {
    throw new TypeError(`workspace runtime: invalid ${key}`)
  }
  return value
}

/**
 * Read and validate payload metadata before exposing any executable path.
 * @param root - Verified payload root selected by the Desktop manager.
 * @returns Parsed immutable payload identity and installed distributions.
 */
export async function readWorkspaceRuntimePayload(root: string): Promise<WorkspaceRuntimePayloadManifest> {
  const value: unknown = JSON.parse(await readFile(join(root, 'runtime.json'), 'utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('workspace runtime: metadata must be an object')
  }
  const record = value as Record<string, unknown>
  if (record.schema !== 'dsh/workspace-runtime-payload/v1'
    || (record.platform !== 'win32' && record.platform !== 'darwin' && record.platform !== 'linux')
    || (record.arch !== 'x64' && record.arch !== 'arm64')
    || record.pythonPackages === null || typeof record.pythonPackages !== 'object'
    || Array.isArray(record.pythonPackages)) {
    throw new TypeError('workspace runtime: invalid metadata')
  }
  const packages = record.pythonPackages as Record<string, unknown>
  if (!Object.entries(packages).every(([name, version]) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)
    && typeof version === 'string' && /^\d[\w.!+-]*$/u.test(version))) {
    throw new TypeError('workspace runtime: invalid Python distribution metadata')
  }
  const normalized = new Set(Object.keys(packages).map(name => name.toLowerCase().replace(/[-_.]+/gu, '-')))
  if (normalized.size !== Object.keys(packages).length) {
    throw new TypeError('workspace runtime: duplicate normalized Python distribution name')
  }
  return {
    schema: record.schema,
    desktopVersion: requireString(record, 'desktopVersion', /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u),
    platform: record.platform,
    arch: record.arch,
    payloadDigest: requireString(record, 'payloadDigest', /^[a-f0-9]{64}$/u),
    pythonVersion: requireString(record, 'pythonVersion', /^\d+\.\d+\.\d+$/u),
    pythonPackages: packages as Readonly<Record<string, string>>,
  }
}

/**
 * Resolve and verify every executable or library path used by the adapter.
 * @param config - Application-owned payload and packaged Node paths.
 * @returns Paths safe to return from `load_workspace_dependencies`.
 */
export async function resolveWorkspaceDependencies(config: Config): Promise<WorkspaceDependencies> {
  if (config.python !== undefined) {
    if (config.pythonPackages === undefined || config.pythonDistributions === undefined) {
      throw new Error('workspace runtime: custom Python metadata is incomplete')
    }
    for (const path of [config.python, config.pythonPackages, config.node, config.pnpm, config.nodePackages]) await stat(path)
    return {
      python: config.python, node: config.node, pnpm: config.pnpm,
      pythonPackages: config.pythonPackages, nodePackages: config.nodePackages,
      pythonDistributions: config.pythonDistributions,
    }
  }
  const manifest = await readWorkspaceRuntimePayload(config.runtimeRoot)
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new Error('workspace runtime: payload does not match this platform')
  }
  const pythonRoot = join(config.runtimeRoot, 'python')
  const python = process.platform === 'win32' ? join(pythonRoot, 'python.exe') : join(pythonRoot, 'bin', 'python3')
  const pythonPackages = process.platform === 'win32'
    ? join(pythonRoot, 'Lib', 'site-packages')
    : join(pythonRoot, 'lib', `python${manifest.pythonVersion.split('.').slice(0, 2).join('.')}`, 'site-packages')
  for (const path of [python, pythonPackages, config.node, config.pnpm, config.nodePackages]) await stat(path)
  return {
    python,
    node: config.node,
    pnpm: config.pnpm,
    pythonPackages,
    nodePackages: config.nodePackages,
    pythonDistributions: manifest.pythonPackages,
  }
}
