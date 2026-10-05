#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCHEMA = 'open-dsh/windows-package-candidate/v1'
const GIT_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024
const QUALIFICATION_ONLY = [
  /^\.artifacts\//u,
  /^\.agents\//u,
  /^\.github\//u,
  /(?:^|\/)tests?\//u,
  /(?:^|\/)[^/]+\.(?:spec|test)\.[^/]+$/u,
  /^apps\/desktop\/scripts\/(?:collect-windows-smoke-evidence|desktop-smoke|electron-package-probe|smoke-macos-package|smoke-windows-package|smoke-windows-unpacked|windows-smoke-journal)\./u,
  /^(?:CONTEXT|AGENTS|README)(?:\.[^/]+)?$/u,
]

function runGit(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: GIT_OUTPUT_LIMIT_BYTES,
  })
  if (result.error !== undefined) {
    throw new Error(`git ${args.join(' ')} failed: ${result.error.message}`, { cause: result.error })
  }
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`)
  return result.stdout.trim()
}

function verifyCandidateSource(root, sourceSha) {
  if (!/^[0-9a-f]{40}$/u.test(sourceSha)) throw new Error('candidate source SHA is invalid')
  const currentSha = runGit(root, ['rev-parse', 'HEAD'])
  if (sourceSha === currentSha) return
  runGit(root, ['merge-base', '--is-ancestor', sourceSha, currentSha])
  const workflowDiff = spawnSync('git', ['diff', '--quiet', sourceSha, currentSha, '--', '.github/workflows/desktop-packages.yml'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (workflowDiff.error !== undefined) throw workflowDiff.error
  if (workflowDiff.status === 1) throw new Error('candidate workflow changed since the installer was built')
  if (workflowDiff.status !== 0) throw new Error(workflowDiff.stderr.trim() || 'cannot compare candidate workflow revisions')
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function included(path) {
  return !QUALIFICATION_ONLY.some(pattern => pattern.test(path))
}

export function packagingInputDigest(root) {
  const records = runGit(root, ['ls-files', '-s']).split(/\r?\n/u).filter(Boolean).map((line) => {
    const match = /^(\d+) ([0-9a-f]{40,64}) \d+\t(.+)$/u.exec(line)
    if (match === null) throw new Error(`unexpected git index record: ${line}`)
    return { mode: match[1], object: match[2], path: match[3] }
  }).filter(record => included(record.path)).sort((left, right) => left.path.localeCompare(right.path))
  const hash = createHash('sha256')
  for (const record of records) hash.update(`${record.mode}\0${record.object}\0${record.path}\n`)
  return hash.digest('hex')
}

async function listFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(root, path))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`candidate snapshot contains unsupported entry: ${relative(root, path)}`)
  }
  return files
}

export async function directoryDigest(directory) {
  const root = resolve(directory)
  const hash = createHash('sha256')
  for (const path of await listFiles(root)) {
    hash.update(`${relative(root, path).replaceAll('\\', '/')}\0`)
    hash.update(await readFile(path))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function installerIdentity(path) {
  const bytes = await readFile(path)
  const metadata = await stat(path)
  if (!metadata.isFile() || metadata.size === 0) throw new Error('candidate installer is missing or empty')
  return { name: basename(path), size: metadata.size, sha256: sha256(bytes) }
}

async function createManifest(root, installer, plugins, output) {
  const document = {
    schema: SCHEMA,
    sourceSha: runGit(root, ['rev-parse', 'HEAD']),
    packagingInputDigest: packagingInputDigest(root),
    bundledPluginDigest: await directoryDigest(plugins),
    installer: await installerIdentity(installer),
  }
  await writeFile(output, `${JSON.stringify(document, undefined, 2)}\n`, 'utf8')
  return document
}

async function verifyManifest(root, installer, plugins, manifest) {
  const document = JSON.parse(await readFile(manifest, 'utf8'))
  if (document.schema !== SCHEMA) throw new Error('candidate manifest schema is unsupported')
  verifyCandidateSource(root, document.sourceSha)
  const expected = {
    packagingInputDigest: packagingInputDigest(root),
    bundledPluginDigest: await directoryDigest(plugins),
    installer: await installerIdentity(installer),
  }
  for (const field of ['packagingInputDigest', 'bundledPluginDigest']) {
    if (document[field] !== expected[field]) throw new Error(`candidate ${field} does not match the current release inputs`)
  }
  for (const field of ['name', 'size', 'sha256']) {
    if (document.installer?.[field] !== expected.installer[field]) throw new Error(`candidate installer ${field} does not match its manifest`)
  }
  return document
}

function usage() {
  console.error('usage: windows-package-candidate.mjs <create|verify> <repository-root> <installer> <bundled-plugins> <manifest>')
  process.exit(2)
}

const [, , command, root, installer, plugins, manifest] = process.argv
if (!['create', 'verify'].includes(command) || [root, installer, plugins, manifest].some(value => value === undefined)) usage()

const result = command === 'create'
  ? await createManifest(resolve(root), resolve(installer), resolve(plugins), resolve(manifest))
  : await verifyManifest(resolve(root), resolve(installer), resolve(plugins), resolve(manifest))
console.log(`Windows candidate ${command} passed: ${result.installer.name} (${result.installer.sha256})`)
