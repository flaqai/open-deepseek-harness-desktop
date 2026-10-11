#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

function usage() {
  console.error('usage: validate-release-notes.mjs <version> <previous-public-tag> <source-sha> <notes-file>')
  process.exit(2)
}

const [, , version, previousTag, sourceSha, notesFile] = process.argv
if (notesFile === undefined
  || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)
  || !/^odsh-v[0-9A-Za-z][0-9A-Za-z._-]*$/u.test(previousTag)
  || !/^[0-9a-f]{40}$/u.test(sourceSha)) usage()

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`)
  return result.stdout.trim()
}

git(['rev-parse', '--verify', `${previousTag}^{commit}`])
const resolvedSource = git(['rev-parse', '--verify', `${sourceSha}^{commit}`])
if (resolvedSource !== sourceSha) throw new Error(`notes source resolved to ${resolvedSource}, expected ${sourceSha}`)
const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', previousTag, sourceSha])
let baselineMode = 'ancestor'
if (ancestor.status === 1) {
  git(['merge-base', previousTag, sourceSha])
  const missingMerges = git(['rev-list', '--merges', `${sourceSha}..${previousTag}`])
  const missingCommits = git(['rev-list', '--count', `${sourceSha}..${previousTag}`])
  const patches = git(['cherry', sourceSha, previousTag]).split('\n').filter(Boolean)
  if (missingMerges !== '' || patches.length !== Number(missingCommits)
    || patches.length === 0 || patches.some(line => !/^- [0-9a-f]{40}$/u.test(line))) {
    throw new Error(`${previousTag} is not an ancestor and contains unverified or missing release changes`)
  }
  baselineMode = 'patch-equivalent'
} else if (ancestor.status !== 0) {
  throw new Error(`Unable to verify release ancestry: ${ancestor.stderr?.toString().trim() ?? ancestor.error?.message ?? ancestor.status}`)
}
const commitCount = Number(git(['rev-list', '--count', `${previousTag}..${sourceSha}`]))
if (!Number.isInteger(commitCount) || commitCount < 1) throw new Error('Release notes range contains no committed changes')

const notes = readFileSync(notesFile, 'utf8')
if (!notes.startsWith(`# Open DeepSeek Harness Desktop v${version}\n`)) {
  throw new Error('Release notes heading does not match the desktop version')
}
for (const heading of ['## 中文', '## English']) {
  const matches = notes.match(new RegExp(`^${heading}$`, 'gmu')) ?? []
  if (matches.length !== 1) throw new Error(`Release notes must contain exactly one ${heading} section`)
}
if (notes.indexOf('## 中文') > notes.indexOf('## English')) throw new Error('Chinese notes must precede English notes')
if (/(?:TODO|TBD|FIXME|待补充|待填写|<[^>]+>)/iu.test(notes)) throw new Error('Release notes contain a placeholder')
for (const fragment of [notes.split('## 中文')[1]?.split('## English')[0], notes.split('## English')[1]]) {
  if ((fragment?.replace(/^#+.*$/gmu, '').trim().length ?? 0) < 20) throw new Error('Both language sections require substantive content')
}

console.log(`release notes verified: ${previousTag}..${sourceSha} (${commitCount} commits; baseline ${baselineMode}), ${notesFile}`)
