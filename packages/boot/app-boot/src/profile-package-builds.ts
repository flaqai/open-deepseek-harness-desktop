/** Durable pnpm build-script approvals owned by one profile. */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isMap, parseDocument, YAMLMap } from 'yaml'

const PROFILE_WORKSPACE_FILENAME = 'pnpm-workspace.yaml'
const PACKAGE_BUILD_KEY = /^(?:@[^/@\s]+\/[^@\s]+|[^/@\s]+)@\S+$/u

/** Result of applying one exact pnpm build-script rule. */
export type ProfilePackageBuildAllowance = 'added' | 'already-allowed' | 'denied'

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, content, { flag: 'wx' })
  renameSync(temporary, path)
}

/**
 * Add one exact pnpm build-script key without overriding an explicit denial.
 * @param profileDir - Profile whose pnpm workspace owns the rule.
 * @param packageBuildKey - Exact dependency path printed by pnpm's Git prepare diagnostic.
 * @returns Whether the rule was added, already allowed, or explicitly denied.
 */
export function allowProfilePackageBuild(
  profileDir: string,
  packageBuildKey: string,
): ProfilePackageBuildAllowance {
  if (packageBuildKey.length > 4096 || !PACKAGE_BUILD_KEY.test(packageBuildKey)) {
    throw new TypeError(`dsh: invalid pnpm allowBuilds key ${JSON.stringify(packageBuildKey)}`)
  }
  const workspacePath = join(profileDir, PROFILE_WORKSPACE_FILENAME)
  const source = readFileSync(workspacePath, 'utf8')
  const document = parseDocument(source)
  if (document.errors.length > 0) {
    throw new Error(`dsh: cannot update ${workspacePath}: ${document.errors.map(error => error.message).join('; ')}`)
  }
  let allowBuilds = document.get('allowBuilds', true)
  if (allowBuilds === undefined) {
    allowBuilds = new YAMLMap()
    document.set('allowBuilds', allowBuilds)
  }
  if (!isMap(allowBuilds)) throw new Error(`dsh: ${workspacePath} allowBuilds must be a YAML mapping`)
  const existing = allowBuilds.get(packageBuildKey)
  if (existing === false) return 'denied'
  if (existing === true) return 'already-allowed'
  if (existing !== undefined) {
    throw new Error(`dsh: ${workspacePath} allowBuilds entry ${JSON.stringify(packageBuildKey)} must be true or false`)
  }
  allowBuilds.set(packageBuildKey, true)
  atomicWrite(workspacePath, document.toString())
  return 'added'
}
