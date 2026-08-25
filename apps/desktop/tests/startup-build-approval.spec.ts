import { describe, expect, it } from 'vitest'
import { parseStartupBuildApproval } from '../src/startup-build-approval.ts'

describe('startup build approval', () => {
  it('extracts the retained exact key and isolated plugin ids', () => {
    const output = JSON.stringify({
      schema: 'dsh/profile-dependency-repair/v1',
      profile: 'web',
      status: 'quarantined',
      conflicts: [],
      quarantined: [{ quarantineId: 'quarantine-1' }],
      diagnostic: 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED\ndsh: pnpm allowBuilds key "open-sea-skin@git+https://example.test/open-sea-skin.git"',
    })
    expect(parseStartupBuildApproval(output)).toEqual({
      packageBuildKey: 'open-sea-skin@git+https://example.test/open-sea-skin.git',
      quarantineIds: ['quarantine-1'],
    })
  })

  it('does not prompt without a completed quarantine transaction', () => {
    expect(parseStartupBuildApproval(JSON.stringify({
      status: 'failed',
      quarantined: [],
      diagnostic: 'dsh: pnpm allowBuilds key "plugin@git+https://example.test/plugin.git"',
    }))).toBeUndefined()
  })

  it('rejects unrelated or malformed output', () => {
    expect(parseStartupBuildApproval('pnpm failed')).toBeUndefined()
    expect(parseStartupBuildApproval(JSON.stringify({
      status: 'quarantined',
      quarantined: [{ quarantineId: 'q' }],
      diagnostic: 'minimum release age violation',
    }))).toBeUndefined()
  })
})
