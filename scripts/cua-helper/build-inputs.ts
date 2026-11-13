/** Content identity for verified Computer Use helper payloads. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const sourceDirectories = [
  'packages/experimental/cua-macos/native', 'scripts/cua-helper', 'apps/desktop/scripts', 'patches',
]
const sourceFiles = new Set([
  '.github/workflows/release.yml', '.github/workflows/macos-intel-package.yml', '.github/workflows/release-publish.yml',
  'package.json', 'scripts/package.json', 'apps/package.json', 'apps/desktop/package.json', 'scripts/release/process.ts',
  'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', '.pnpmfile.cjs', '.pnpmfile.mjs',
])

function isSourceFile(path: string): boolean {
  return sourceFiles.has(path) || path === '.gitattributes' || path.endsWith('/.gitattributes') || /^(?:(?:apps|apps\/desktop|scripts)\/)?tsconfig[^/]*\.json$/u.test(path)
    || path.split('/').includes('node_modules')
    || sourceDirectories.some(directory => path.startsWith(`${directory}/`))
}

function trackedSources(root: string): string[] {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\0').filter(isSourceFile).sort()
  for (const required of ['packages/experimental/cua-macos/native/Package.swift', 'scripts/cua-helper/payload.ts',
    'package.json', 'pnpm-lock.yaml']) {
    if (!files.includes(required)) throw new Error(`CUA source: missing tracked build input ${required}`)
  }
  return files
}

function manifestConfiguration(bytes: Buffer, root: boolean): Buffer {
  const manifest: unknown = JSON.parse(bytes.toString('utf8'))
  assert(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'CUA source: invalid package manifest')
  assert(!root || ('packageManager' in manifest && typeof manifest.packageManager === 'string'),
    'CUA source: package.json must declare packageManager')
  return Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(manifest).filter(([name]) => name !== 'version'))))
}

function sourceFile(root: string, file: string): { bytes: Buffer; executable: boolean } {
  const path = join(root, file)
  const stat = lstatSync(path)
  if (!stat.isFile()) throw new Error(`CUA source: build input must be a regular file: ${file}`)
  return { bytes: readFileSync(path), executable: (stat.mode & 0o111) !== 0 }
}

function gitBlobHash(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

/**
 * Hash tracked build inputs by path, bytes and executable mode; only package manifest version fields is excluded.
 * Missing tracked files and links fail; build outputs and untracked files never enter the digest.
 * @param root - Clean repository root containing all helper build inputs.
 * @returns SHA-256 of sources, resources, workflows, package configuration, patches and locked dependencies.
 */
export function cuaHelperSourceDigest(root: string): string {
  const hash = createHash('sha256')
  for (const file of trackedSources(root)) {
    const { bytes, executable } = sourceFile(root, file)
    const input = file === 'package.json' || file.endsWith('/package.json') ? manifestConfiguration(bytes, file === 'package.json') : bytes
    hash.update(`${file}\0`).update(createHash('sha256').update(input).digest()).update(Buffer.from([Number(executable)]))
  }
  return hash.digest('hex')
}

/**
 * Compare a producer's immutable GitHub commit tree with local build inputs independently of artifact metadata.
 * Incomplete trees, unreadable blobs and API failures stop selection; content differences return false.
 * @param root - Consumer repository root, before dependency installation.
 * @param repository - GitHub repository containing the authenticated producer run.
 * @param commit - Producer head SHA returned by GitHub, never an artifact-supplied revision.
 * @param api - Read-only GitHub JSON reader.
 * @returns Resolves to whether selected paths, bytes and executable modes match, excluding package manifest version fields.
 */
export async function cuaHelperSourceMatches(root: string, repository: string, commit: string,
  api: (path: string) => Promise<unknown>): Promise<boolean> {
  assert(/^[a-f0-9]{40}$/u.test(commit), 'CUA source: invalid producer commit')
  const response = await api(`repos/${repository}/git/trees/${commit}?recursive=1`)
  assert(response && typeof response === 'object' && 'truncated' in response && response.truncated === false
    && 'tree' in response && Array.isArray(response.tree), 'CUA source: GitHub returned an incomplete commit tree')
  const tree = new Map<string, { sha: string; mode: string }>()
  const entries: unknown[] = response.tree
  for (const value of entries) {
    assert(value && typeof value === 'object' && 'path' in value && typeof value.path === 'string', 'CUA source: invalid tree entry')
    if (!isSourceFile(value.path) || ('type' in value && value.type === 'tree')) continue
    assert('sha' in value && typeof value.sha === 'string' && /^[a-f0-9]{40}$/u.test(value.sha)
      && 'mode' in value && typeof value.mode === 'string' && 'type' in value, 'CUA source: invalid source entry')
    if (value.type !== 'blob' || !['100644', '100755'].includes(value.mode)) return false
    assert(!tree.has(value.path), 'CUA source: duplicate source entry')
    tree.set(value.path, { sha: value.sha, mode: value.mode })
  }
  const files = trackedSources(root)
  if (tree.size !== files.length) return false
  for (const file of files) {
    const remote = tree.get(file)
    if (!remote) return false
    const local = sourceFile(root, file)
    if (remote.mode !== (local.executable ? '100755' : '100644')) return false
    if (gitBlobHash(local.bytes) === remote.sha) continue
    const canonical = execFileSync('git', ['hash-object', `--path=${file}`, '--stdin'],
      { cwd: root, input: local.bytes, encoding: 'utf8' }).trim()
    if (canonical === remote.sha) continue
    if (file !== 'package.json' && !file.endsWith('/package.json')) return false
    const blob = await api(`repos/${repository}/git/blobs/${remote.sha}`)
    assert(blob && typeof blob === 'object' && 'sha' in blob && blob.sha === remote.sha
      && 'encoding' in blob && blob.encoding === 'base64' && 'content' in blob && typeof blob.content === 'string',
    'CUA source: invalid package manifest blob')
    const bytes = Buffer.from(blob.content, 'base64')
    assert(gitBlobHash(bytes) === remote.sha, 'CUA source: package manifest blob digest mismatch')
    if (!manifestConfiguration(local.bytes, file === 'package.json').equals(manifestConfiguration(bytes, file === 'package.json'))) return false
  }
  return true
}
