import { describe, expect, it } from 'vitest'
import {
  acceptsExternalTools,
  externalToolEnabled,
} from '../src/external-tools.ts'

describe('Host-connected external-tool projection', () => {
  it('targets only the shipped complete coding presets', () => {
    expect(acceptsExternalTools('standard')).toBe(true)
    expect(acceptsExternalTools('code')).toBe(true)
    expect(acceptsExternalTools('cordis')).toBe(true)
    expect(acceptsExternalTools('minimal')).toBe(false)
    expect(acceptsExternalTools('custom')).toBe(false)
    expect(acceptsExternalTools(undefined)).toBe(false)
  })

  it('resolves absent settings to disconnected and keeps product keys independent', () => {
    expect(externalToolEnabled(undefined, 'codex')).toBe(false)
    expect(externalToolEnabled({}, 'claude-code')).toBe(false)
    expect(externalToolEnabled({ codex: true }, 'codex')).toBe(true)
    expect(externalToolEnabled({ codex: true }, 'claude-code')).toBe(false)
    expect(externalToolEnabled({ claudeCode: true }, 'claude-code')).toBe(true)
  })
})
