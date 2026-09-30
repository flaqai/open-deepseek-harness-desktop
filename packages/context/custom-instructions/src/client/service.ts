/** Trusted browser-side editor over the custom-instruction settings namespace. */

import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsNavigation } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  CustomInstructionHistory,
  CustomInstructionSettings,
  CustomInstructionVersion,
} from '../types.ts'

/** Stable Settings section id. */
export const CUSTOM_INSTRUCTIONS_SECTION_ID = 'custom-instructions'

function versionId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Return the active immutable revision in one history.
 * @param history - saved revision history for one instruction scope.
 * @returns the selected revision, or `undefined` when the scope is disabled.
 */
export function activeCustomInstruction(
  history: CustomInstructionHistory | undefined,
): CustomInstructionVersion | undefined {
  if (history?.activeVersion === undefined) return undefined
  return history.versions.find(version => version.id === history.activeVersion)
}

/** Human-only operations exposed to first-party Settings and Workspace UI. */
export interface CustomInstructionsClient {
  readonly scope: ConfigForm<CustomInstructionSettings>
  /** Open the global custom-instruction editor. */
  openGlobal(): void
  /**
   * Open the editor for one registered Workspace.
   * @param workspaceId - stable id of the Workspace to edit.
   */
  openWorkspace(workspaceId: WorkspaceId): void
  /**
   * Save or disable the active immutable revision for one scope.
   * @param scope - global scope or the target Workspace id.
   * @param text - plaintext instruction; an empty value disables the scope.
   * @param expectedRevision - optional optimistic settings revision.
   */
  save(scope: 'global' | WorkspaceId, text: string, expectedRevision?: number): Promise<void>
  /**
   * Remove editor history after its owning Workspace was deleted.
   * @param workspaceId - id of the deleted Workspace.
   */
  workspaceDeleted(workspaceId: WorkspaceId): Promise<void>
  /**
   * Persist how future diagnostic exports handle plaintext custom instructions.
   * @param preference - ask every time, include automatically, or exclude automatically.
   */
  setDiagnosticExportPreference(preference: 'ask' | 'include' | 'exclude'): Promise<void>
}

/**
 * Build the trusted first-party editor service.
 * @param scope - settings binding for the custom-instructions namespace.
 * @param navigation - Settings navigation used by global and Workspace entry points.
 * @returns the human-only editing and navigation service.
 */
export function createCustomInstructionsClient(
  scope: ConfigForm<CustomInstructionSettings>,
  navigation: SettingsNavigation,
): CustomInstructionsClient {
  const open = (subsectionId: string): void => {
    navigation.open({ sectionId: CUSTOM_INSTRUCTIONS_SECTION_ID, subsectionId })
  }
  return {
    scope,
    openGlobal: () => { open('global') },
    openWorkspace: (workspaceId) => { open(`workspace:${workspaceId}`) },
    save: async (target, text, expectedRevision) => {
      const snapshot = scope.getSnapshot()
      if (snapshot.value === undefined) throw new Error('custom instructions settings are unavailable')
      const normalized = text.trim()
      const history = target === 'global'
        ? snapshot.value.global
        : snapshot.value.workspaces[String(target)] ?? { versions: [] }
      const active = activeCustomInstruction(history)
      if ((active?.text ?? '') === normalized) return
      const next: CustomInstructionHistory = normalized === ''
        ? { versions: history.versions }
        : (() => {
          const version = { id: versionId(), text: normalized, createdAt: Date.now() }
          return { activeVersion: version.id, versions: [...history.versions, version] }
        })()
      const value: JsonValue = {
        ...(next.activeVersion === undefined ? {} : { activeVersion: next.activeVersion }),
        versions: next.versions.map(version => ({
          id: version.id,
          text: version.text,
          createdAt: version.createdAt,
        })),
      }
      if (target === 'global') {
        if (!await scope.mutate([{ op: 'set', path: ['global'], value }], expectedRevision)) {
          throw new Error('custom instructions profile edit was refused')
        }
        return
      }
      if (!await scope.mutate([{ op: 'set', path: ['workspaces', String(target)], value }], expectedRevision)) {
        throw new Error('custom instructions profile edit was refused')
      }
    },
    workspaceDeleted: async (workspaceId) => {
      const settings = scope.getSnapshot().value
      if (settings === undefined || settings.workspaces[String(workspaceId)] === undefined) return
      // Every model-visible revision is copied into the Session event source,
      // so deleting the Workspace may safely discard this editor-only history.
      if (!await scope.mutate([{ op: 'unset', path: ['workspaces', String(workspaceId)] }])) {
        throw new Error('custom instructions profile edit was refused')
      }
    },
    setDiagnosticExportPreference: async (preference) => {
      if (!await scope.mutate([{ op: 'set', path: ['diagnosticExport', 'preference'], value: preference }])) {
        throw new Error('custom instructions profile edit was refused')
      }
    },
  }
}
