import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries, loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'
import { withBuiltinMcpSettings } from '../src/builtin-mcp-settings.ts'

function fixture(): PatchOptions[] {
  return [{ insert: [
    { id: 'builtin', name: '@deepseek-ai/dsh-mcp-settings' },
    { id: 'custom-panel-id', name: '@dsh-plugins/mcp-panel' },
    { id: 'mcp-server-private', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'private' } },
    { id: 'other-panel', name: '@other/mcp-panel' },
  ] }]
}

it('disables the exact legacy package even with a custom row id without changing MCP servers or source patches', () => {
  const patches = fixture()
  const before = structuredClone(patches)
  const projected = withBuiltinMcpSettings(patches)
  const rows = composeEntries([projected])
  expect(rows.find(row => row.id === 'custom-panel-id')?.disabled).toBe(true)
  expect(rows.filter(row => row.id !== 'custom-panel-id')).toEqual(composeEntries([before]).filter(row => row.id !== 'custom-panel-id'))
  expect(patches).toEqual(before)
  expect(withBuiltinMcpSettings(projected)).toBe(projected)
})

it.each([undefined, true])('preserves the old panel when the replacement is absent or disabled (%s)', (disabled) => {
  const patches: PatchOptions[] = disabled === undefined
    ? [{ insert: [{ id: 'custom-panel-id', name: '@dsh-plugins/mcp-panel' }] }]
    : [...fixture(), { id: 'builtin', disabled }]
  expect(withBuiltinMcpSettings(patches)).toBe(patches)
})

it.each([false, null])('applies literal built-in enabled state (%s)', (disabled) => {
  const patches = [...fixture(), { id: 'builtin', disabled }]
  expect(composeEntries([withBuiltinMcpSettings(patches)]).find(row => row.id === 'custom-panel-id')?.disabled).toBe(true)
})

it('does not evaluate a conditional disabled expression or assume it enables the replacement', () => {
  const dir = mkdtempSync(join(tmpdir(), 'builtin-mcp-projection-'))
  onTestFinished(() => { rmSync(dir, { recursive: true, force: true }) })
  const path = join(dir, 'cordis.patch.yml')
  const source = '- id: builtin\n  disabled: !!js (() => { throw new Error("must not evaluate") })()\n'
  writeFileSync(path, source)
  const user = loadOptionalPatches('dsh', path)
  expect(user).toBeDefined()
  const patches = [...fixture(), ...user ?? []]
  expect(withBuiltinMcpSettings(patches)).toBe(patches)
})

it('recomputes from the HMR source layers when the built-in row is disabled or enabled again', () => {
  const patches = fixture()
  const before = structuredClone(patches)
  expect(composeEntries([withBuiltinMcpSettings(patches)]).find(row => row.id === 'custom-panel-id')?.disabled).toBe(true)
  const disabled = [...patches, { id: 'builtin', disabled: true }]
  expect(composeEntries([withBuiltinMcpSettings(disabled)]).find(row => row.id === 'custom-panel-id')?.disabled).toBeUndefined()
  const enabled = [...disabled, { id: 'builtin', disabled: false }]
  expect(composeEntries([withBuiltinMcpSettings(enabled)]).find(row => row.id === 'custom-panel-id')?.disabled).toBe(true)
  expect(patches).toEqual(before)
})

it('leaves profiles without a legacy row untouched', () => {
  const patches: PatchOptions[] = [{ insert: [{ id: 'builtin', name: '@deepseek-ai/dsh-mcp-settings' }] }]
  expect(withBuiltinMcpSettings(patches)).toBe(patches)
})
