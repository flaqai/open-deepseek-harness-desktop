/** Fixed product destinations; the native menu cannot navigate to arbitrary URLs. */
const sections: Readonly<Record<string, string>> = {
  settings: 'general', updates: 'about', market: 'market', 'plugin-restore': 'plugin-restore',
  diagnostics: 'diagnostics', snapshots: 'diagnostics', 'external-tools': 'external-tools', 'orb-settings': 'orb',
  im: 'xmanrui-dsh-im', 'data-home': 'general',
}

/** Dependencies of the restricted native-menu navigation adapter. */
export interface MenuNavigation {
  startSession(): void
  open(request: { sectionId: string; subsectionId?: string }): void
  hasSection(id: string): boolean
  unavailable(): string
  general(destination: 'data-home' | 'updates'): void
  openRemoteControl(): void | Promise<void>
}

/** Route through existing services, never DOM clicks or direct plugin installs.
 * @param command - Allowlisted host command.
 * @param navigation - Existing client services.
 * @returns after the remote-control destination opens, or immediately for synchronous destinations.
 */
export function navigateDesktopMenu(command: string, navigation: MenuNavigation): void | Promise<void> {
  if (command === 'new-session') { navigation.startSession(); return }
  if (command === 'phone') return navigation.openRemoteControl()
  const sectionId = sections[command]
  if (sectionId === undefined || !navigation.hasSection(sectionId)) throw new Error(navigation.unavailable())
  if (command === 'data-home' || command === 'updates') navigation.general(command)
  navigation.open({ sectionId, ...(command === 'snapshots' ? { subsectionId: 'snapshots' } : {}) })
}
