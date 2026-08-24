import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allowProfilePackageBuild } from '../src/profile-package-builds.ts'

describe('profile package build approvals', () => {
  it('adds one exact rule while preserving user comments and settings', () => {
    const profile = mkdtempSync(join(tmpdir(), 'dsh-profile-builds-'))
    const workspace = join(profile, 'pnpm-workspace.yaml')
    writeFileSync(workspace, 'packages:\n  - .\n\n# user setting\nnodeLinker: hoisted\n')
    try {
      const key = 'open-sea-skin@github:d-dev0101/open-sea-skin#commit'
      expect(allowProfilePackageBuild(profile, key)).toBe('added')
      expect(allowProfilePackageBuild(profile, key)).toBe('already-allowed')
      const content = readFileSync(workspace, 'utf8')
      expect(content).toContain('# user setting')
      expect(content).toContain('allowBuilds:')
      expect(content).toContain('open-sea-skin@github:d-dev0101/open-sea-skin#commit: true')
    } finally {
      rmSync(profile, { recursive: true, force: true })
    }
  })

  it('preserves an explicit denial and rejects malformed diagnostic keys', () => {
    const profile = mkdtempSync(join(tmpdir(), 'dsh-profile-builds-denied-'))
    const workspace = join(profile, 'pnpm-workspace.yaml')
    const key = 'open-sea-skin@github:d-dev0101/open-sea-skin#commit'
    const source = `packages:\n  - .\nallowBuilds:\n  ${key}: false\n`
    writeFileSync(workspace, source)
    try {
      expect(allowProfilePackageBuild(profile, key)).toBe('denied')
      expect(readFileSync(workspace, 'utf8')).toBe(source)
      expect(() => allowProfilePackageBuild(profile, 'open-sea-skin'))
        .toThrow('invalid pnpm allowBuilds key')
      writeFileSync(workspace, `packages:\n  - .\nallowBuilds:\n  ${key}: inherited\n`)
      expect(() => allowProfilePackageBuild(profile, key)).toThrow('must be true or false')
    } finally {
      rmSync(profile, { recursive: true, force: true })
    }
  })
})
