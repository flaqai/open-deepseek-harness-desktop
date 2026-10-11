#!/usr/bin/env node

import { accessSync, constants, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

function usage() {
  console.error('usage: release-doctor.mjs [--release-state stable|prerelease] [--previous-tag <tag>] [--minimum-free-gib <gib>] [--minimum-mibps <mibps>] [--cnb-repository <owner/repo>] <owner/repo>')
  process.exit(2)
}

const options = {
  releaseState: 'stable',
  minimumFreeGib: 10,
  minimumMibps: 1,
  cnbRepository: 'hecoococ/open-deepseek-harness-desktop',
}
const operands = []
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index]
  const value = () => process.argv[++index] ?? usage()
  if (argument === '--release-state') options.releaseState = value()
  else if (argument === '--previous-tag') options.previousTag = value()
  else if (argument === '--minimum-free-gib') options.minimumFreeGib = Number(value())
  else if (argument === '--minimum-mibps') options.minimumMibps = Number(value())
  else if (argument === '--cnb-repository') options.cnbRepository = value()
  else if (argument.startsWith('-')) usage()
  else operands.push(argument)
}
if (operands.length !== 1 || !['stable', 'prerelease'].includes(options.releaseState)
  || !Number.isInteger(options.minimumFreeGib) || options.minimumFreeGib < 0
  || !Number.isFinite(options.minimumMibps) || options.minimumMibps < 0) usage()
const repository = operands[0]
const repositoryPattern = /^[^/\s]+\/[^/\s]+$/u
if (![repository, options.cnbRepository].every(value => repositoryPattern.test(value))) usage()

const scriptDirectory = resolve(import.meta.dirname)
const root = run('git', ['rev-parse', '--show-toplevel']).trim()
const commonGitDirectory = run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
const version = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8')).version
const tag = `odsh-v${version}`
const branch = run('git', ['branch', '--show-current']).trim()
const sourceSha = run('git', ['rev-parse', 'HEAD']).trim()
const planPath = join(commonGitDirectory, 'odsh-release-state', `${version}.plan.json`)
const renderedPath = join(commonGitDirectory, 'odsh-release-state', `${version}.md`)
const notesPath = join(root, '.artifacts', 'release-notes', `${tag}.md`)
const checks = []

function run(command, args, settings = {}) {
  const result = spawnSync(command, args, {
    cwd: settings.cwd ?? process.cwd(), encoding: 'utf8',
    env: settings.env ?? process.env, stdio: settings.stdio ?? ['ignore', 'pipe', 'pipe'],
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`)
  }
  return result.stdout
}

function check(name, action) {
  try {
    const evidence = action()
    checks.push({ name, status: 'PASS', evidence: evidence === undefined ? '' : String(evidence) })
  } catch (error) {
    checks.push({ name, status: 'FAIL', evidence: error instanceof Error ? error.message : String(error) })
  }
}

function executable(command) {
  const output = run('/usr/bin/env', ['sh', '-c', 'command -v "$1"', 'release-doctor', command]).trim()
  accessSync(output, constants.X_OK)
  return output
}

function worktreePaths() {
  const entries = run('git', ['worktree', 'list', '--porcelain']).split(/\r?\n/u)
  return entries.filter(line => line.startsWith('worktree ')).map(line => line.slice('worktree '.length))
}

function workflowContract() {
  const source = readFileSync(join(root, '.github/workflows/desktop-packages.yml'), 'utf8')
  if (!/^permissions:\s*\n\s+contents:\s*read\s*$/mu.test(source)) throw new Error('desktop-packages.yml must declare top-level contents: read')
  if (/\bgh\s+release\b|softprops\/action-gh-release|\brelease\s+(?:create|upload|edit)\b/iu.test(source)) {
    throw new Error('desktop package qualification must not publish Releases')
  }
  for (const input of ['target', 'refresh_plugins', 'bundled_plugin_run_id', 'orchestration_id', 'windows_candidate_run_id']) {
    if (!new RegExp(`^ {6}${input}:`, 'mu').test(source)) throw new Error(`desktop-packages.yml is missing workflow input ${input}`)
  }
  return 'qualification-only workflow contract'
}

for (const command of ['git', 'gh', 'node', 'df', 'shasum', 'curl', 'unzip']) {
  check(`command:${command}`, () => executable(command))
}
check('source:named-branch', () => { if (branch === '') throw new Error('release preparation requires a named branch'); return branch })
check('source:current-worktree-clean', () => {
  const status = run('git', ['status', '--porcelain'], { cwd: root }).trim()
  if (status !== '') throw new Error(`current worktree is dirty:\n${status}`)
  return sourceSha
})
check('source:all-worktrees-reviewed', () => {
  const dirty = []
  for (const path of worktreePaths()) {
    const status = run('git', ['status', '--porcelain'], { cwd: path }).trim()
    if (status !== '') dirty.push(`${path}: ${status.split(/\r?\n/u).length} change(s)`)
  }
  if (dirty.length > 0) throw new Error(`dirty worktrees require review:\n${dirty.join('\n')}`)
  return `${worktreePaths().length} clean worktree(s)`
})
check('source:remote-head', () => {
  const remoteSha = run('git', ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], { cwd: root }).trim().split(/\s+/u)[0]
  if (remoteSha !== sourceSha) throw new Error(`origin/${branch} is ${remoteSha || 'missing'}, expected ${sourceSha}`)
  return remoteSha
})
check('release:tag-available', () => {
  const result = spawnSync('gh', ['release', 'view', tag, '--repo', repository], { encoding: 'utf8' })
  if (result.status === 0) throw new Error(`GitHub Release ${tag} already exists`)
  return tag
})
let previousTag = options.previousTag
check('release:previous-public', () => {
  previousTag ??= run('gh', ['release', 'list', '--repo', repository, '--exclude-drafts', '--limit', '20', '--json', 'tagName,publishedAt', '--jq', 'sort_by(.publishedAt) | reverse | .[0].tagName']).trim()
  if (!/^odsh-v[0-9A-Za-z][0-9A-Za-z._-]*$/u.test(previousTag)) throw new Error('could not identify the previous public desktop Release')
  return previousTag
})
check('release:notes', () => {
  const stat = statSync(notesPath)
  if (!stat.isFile() || stat.size === 0) throw new Error(`missing filled bilingual notes: ${notesPath}`)
  return run(process.execPath, [join(scriptDirectory, 'validate-release-notes.mjs'), version, previousTag, sourceSha, notesPath]).trim()
})
check('release:workflow-contract', workflowContract)
check('release:free-space', () => {
  const availableKib = Number(run('df', ['-Pk', root]).trim().split(/\r?\n/u).at(-1).trim().split(/\s+/u)[3])
  const availableGib = availableKib / 1024 / 1024
  if (!Number.isFinite(availableGib) || availableGib < options.minimumFreeGib) {
    throw new Error(`only ${availableGib.toFixed(1)} GiB free; ${options.minimumFreeGib} GiB required`)
  }
  return `${availableGib.toFixed(1)} GiB free`
})
check('publication:cnb-variable', () => {
  const value = run('gh', ['variable', 'get', 'CNB_SYNC_ENABLED', '--repo', repository]).trim()
  if (value !== 'true') throw new Error('CNB_SYNC_ENABLED must equal true')
  return 'CNB_SYNC_ENABLED=true'
})
check('publication:cnb-secret', () => {
  const names = run('gh', ['secret', 'list', '--repo', repository, '--json', 'name', '--jq', '.[].name']).trim().split(/\r?\n/u)
  if (!names.includes('CNB_TOKEN')) throw new Error('CNB_TOKEN secret is not configured')
  return 'CNB_TOKEN is configured'
})
check('publication:cnb-workflow', () => {
  run('gh', ['workflow', 'view', 'sync-cnb-desktop-releases.yml', '--repo', repository])
  return 'sync-cnb-desktop-releases.yml is available'
})

const failedBeforeNetwork = checks.some(entry => entry.status === 'FAIL')
let networkEvidence = ''
if (!failedBeforeNetwork) {
  check('network:release-endpoints', () => {
    networkEvidence = run(join(scriptDirectory, 'check-release-endpoints.sh'), [repository]).trim()
    return networkEvidence
  })
} else {
  checks.push({ name: 'network:release-endpoints', status: 'SKIP', evidence: 'fix earlier release doctor failures first' })
}

const failed = checks.filter(entry => entry.status === 'FAIL')
if (failed.length === 0) {
  run(process.execPath, [join(scriptDirectory, 'release-plan.mjs'), 'init', planPath, version, repository,
    options.cnbRepository, branch, sourceSha, previousTag, options.releaseState,
    String(options.minimumMibps)])
  run(process.execPath, [join(scriptDirectory, 'release-plan.mjs'), 'set', planPath,
    'notes.status', 'verified', 'network.status', 'verified',
    'network.route', /release endpoints:[^\n]* via ([^\s]+)/u.exec(networkEvidence)?.[1] ?? 'unknown'])
  run(process.execPath, [join(scriptDirectory, 'release-plan.mjs'), 'render', planPath, renderedPath])
}

console.log('# Desktop release doctor')
console.log(`\n- Version: \`${version}\``)
console.log(`- Source: \`${branch}\` at \`${sourceSha}\``)
console.log(`- Planned tag: \`${tag}\``)
console.log(`- Plan: \`${planPath}\``)
console.log('\n| Check | Result | Evidence |')
console.log('| --- | --- | --- |')
for (const entry of checks) console.log(`| ${entry.name} | ${entry.status} | ${entry.evidence.replaceAll('|', '\\|').replaceAll('\n', '<br>')} |`)
if (failed.length > 0) {
  console.error(`release doctor failed ${failed.length} check(s); no release plan was created or changed`)
  process.exit(1)
}
console.log(`\nRelease doctor passed. Generated ${renderedPath}`)
