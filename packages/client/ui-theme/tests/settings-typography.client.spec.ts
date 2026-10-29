import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it.each([
  ['ui-settings-general', 'GeneralSection'],
  ['ui-settings-models', 'ModelsSection'],
  ['ui-settings-plugins', 'PluginsSettingsSection'],
  ['ui-agent-preset', 'AgentPresetSection'],
  ['ui-settings-plugin-inventory', 'ExternalToolsSection'],
  ['ui-settings-plugin-inventory', 'PluginDiagnosticsSection'],
  ['ui-settings-plugin-inventory', 'PluginInventorySettingsTab'],
  ['ui-desktop-shell', 'DesktopShell'],
  ['ui-desktop-shell', 'DesktopIconSettings'],
])('keeps %s/%s settings on the shared body type scale', (packageName, component) => {
  const styles = readFileSync(new URL(`../../${packageName}/src/client/${component}.module.css`, import.meta.url), 'utf8')
  expect(styles).toContain('font: var(--dsw-font-s-14)')
  expect(styles).not.toMatch(/font-size:\s*(?:18|20|22)px/u)
})
