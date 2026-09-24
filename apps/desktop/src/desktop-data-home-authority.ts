/** Desktop ownership of data-home selection, validation, preparation, and publication. */

import { randomUUID } from 'node:crypto'
import { inspectPortablePluginTransfer } from './portable-plugin-transfer.ts'
import type { PortablePluginTarget } from './portable-plugin-bundle.ts'
import {
  copyCommunityDesktopData,
  desktopDataHomeSetup,
  desktopDataHomesOverlap,
  ensureCommunityProfileIdentity,
  hasDesktopData,
  importOfficialDesktopData,
  IMPORTED_ONBOARDING_RESET_VERSION,
  inspectDesktopDataHomeStatus,
  readDesktopDataHomeSetup,
  resetImportedDesktopOnboarding,
  resolveCommunityDataHomeSource,
  resolveDesktopDataHomeRecoverySelection,
  resolveDesktopDataHomeSource,
  resolveDesktopDataHomeSwitch,
  resolveEmptyDesktopDataHome,
  resolveRecordedDesktopDataHome,
  resolveUnidentifiedCommunityDataHomeSource,
  writeDesktopDataHomeSetup,
  type DesktopDataHomeLayout,
  type DesktopDataHomeSelectionKind,
  type DesktopDataHomeSelectionResult,
  type DesktopDataHomeSource,
  type DesktopDataHomeStatus,
  type DesktopDataHomeSwitchRequest,
  type DesktopDataHomeSwitchResult,
  type DesktopDataHomeSetup,
} from './desktop-data-home.ts'

const DEFAULT_SELECTION_LIFETIME_MS = 5 * 60_000

export type DesktopDataHomeSourceKind = 'official' | 'community'

export type DesktopDataHomeChoice =
  | { readonly mode: 'fresh'; readonly target: string; readonly customTarget: boolean }
  | {
    readonly mode: 'copied'
    readonly sourceKind: DesktopDataHomeSourceKind
    readonly source: string
    readonly target: string
    readonly customTarget: boolean
    readonly portableTransfer?: { readonly path: string; readonly sha256: string }
  }
  | { readonly mode: 'reused'; readonly sourceKind: 'community'; readonly source: string }

type DesktopDataHomeChoiceRequest =
  | {
    readonly mode: 'fresh'
    readonly target: { readonly kind: 'default' } | { readonly kind: 'custom'; readonly selectionId: string }
  }
  | {
    readonly mode: 'copied'
    readonly sourceKind: DesktopDataHomeSourceKind
    readonly source: string
    readonly sourceSelectionId?: string
    readonly target: { readonly kind: 'default' } | { readonly kind: 'custom'; readonly selectionId: string }
    readonly pluginMigration?: { readonly mode: 'online' } | { readonly mode: 'offline'; readonly selectionId: string }
  }
  | {
    readonly mode: 'reused'
    readonly sourceKind: 'community'
    readonly source: string
    readonly sourceSelectionId?: string
  }

export type DesktopDataHomeSourceResult =
  | {
    readonly status: 'valid'
    readonly path: string
    readonly entries: readonly string[]
    readonly selectionId?: string
  }
  | { readonly status: 'confirmation-required'; readonly path: string; readonly entries: readonly string[] }
  | { readonly status: 'invalid' | 'unreadable'; readonly path: string }
  | { readonly status: 'cancelled' }

export type DesktopDataHomeTargetResult =
  | { readonly status: 'selected'; readonly selectionId: string; readonly path: string }
  | { readonly status: 'not-empty' | 'overlap' | 'unreadable'; readonly path: string }
  | { readonly status: 'cancelled' }

export type DesktopDataHomePortableResult =
  | { readonly status: 'selected'; readonly selectionId: string; readonly target: PortablePluginTarget }
  | { readonly status: 'invalid' | 'unreadable' | 'cancelled' }

export type DesktopDataHomeSubmission =
  | { readonly status: 'ignored' }
  | { readonly status: 'selected'; readonly choice: DesktopDataHomeChoice }
  | { readonly status: 'source-error'; readonly result: Extract<DesktopDataHomeSourceResult, { status: 'invalid' | 'unreadable' }> }
  | { readonly status: 'target-error'; readonly result: Extract<DesktopDataHomeTargetResult, { status: 'not-empty' | 'overlap' | 'unreadable' }> }

export interface DesktopDataHomeChooserPresentation {
  readonly officialSource?: DesktopDataHomeSource
  readonly officialSourceUnreadable: boolean
  readonly officialSourceCandidate: string
  readonly communitySource?: DesktopDataHomeSource
  readonly communitySourceUnreadable: boolean
  readonly communitySourceCandidate: string
  readonly defaultTarget: string
  readonly returnToMain: boolean
  readonly defaultTargetAvailable: boolean
}

interface PendingPath {
  readonly path: string
  readonly expiresAt: number
}

interface PendingRendererPath extends PendingPath {
  readonly rendererId: number
  readonly selectionKind: DesktopDataHomeSelectionKind
}

export class DesktopDataHomeSelectionCancelledError extends Error {
  constructor() {
    super('desktop: data-home selection was cancelled')
    this.name = 'DesktopDataHomeSelectionCancelledError'
  }
}

export interface DesktopDataHomeAuthorityOptions {
  readonly layout: DesktopDataHomeLayout
  readonly selectionLifetimeMs?: number
  readonly now?: () => number
  readonly createSelectionId?: () => string
  stopActiveProfile(): Promise<void>
  scheduleRestart(): void
}

export interface DesktopDataHomeInitializationResult {
  readonly path: string
  readonly copied: boolean
}

interface PreparedDataHomeChoice extends DesktopDataHomeInitializationResult {
  readonly setup: DesktopDataHomeSetup
}

function isSelectionId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/u.test(value)
}

function isDataHomeChoiceRequest(value: unknown): value is DesktopDataHomeChoiceRequest {
  if (typeof value !== 'object' || value === null || !('mode' in value)
    || (value.mode !== 'copied' && value.mode !== 'reused' && value.mode !== 'fresh')) return false
  const sourceSelectionValid = !('sourceSelectionId' in value) || isSelectionId(value.sourceSelectionId)
  if (!sourceSelectionValid) return false
  if ('sourceSelectionId' in value
    && (value.mode === 'fresh' || !('sourceKind' in value) || value.sourceKind !== 'community')) return false
  if (value.mode === 'reused') {
    return 'sourceKind' in value && value.sourceKind === 'community'
      && 'source' in value && typeof value.source === 'string' && value.source.trim().length > 0
  }
  if (value.mode === 'copied'
    && (!('source' in value) || typeof value.source !== 'string' || value.source.trim().length === 0
      || !('sourceKind' in value) || (value.sourceKind !== 'official' && value.sourceKind !== 'community'))) return false
  if (value.mode === 'copied' && 'pluginMigration' in value) {
    const migration = value.pluginMigration
    if (typeof migration !== 'object' || migration === null || !('mode' in migration)
      || (migration.mode !== 'online' && migration.mode !== 'offline')
      || (migration.mode === 'offline' && (!('selectionId' in migration) || !isSelectionId(migration.selectionId)))) return false
  }
  if (!('target' in value) || typeof value.target !== 'object' || value.target === null
    || !('kind' in value.target)) return false
  return value.target.kind === 'default'
    || (value.target.kind === 'custom' && 'selectionId' in value.target && isSelectionId(value.target.selectionId))
}

function isSwitchRequest(value: unknown): value is DesktopDataHomeSwitchRequest {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return false
  if (value.kind === 'desktop' || value.kind === 'official') return true
  return (value.kind === 'custom' || value.kind === 'create')
    && 'selectionId' in value && isSelectionId(value.selectionId)
}

/** One chooser's bounded validation state; presentation adapters never receive raw filesystem authority. */
export class DesktopDataHomeChooserSession {
  readonly presentation: DesktopDataHomeChooserPresentation
  readonly #currentDataHome: string | undefined
  readonly #now: () => number
  readonly #createSelectionId: () => string
  readonly #selectionLifetimeMs: number
  readonly #pendingTargets = new Map<string, PendingPath>()
  readonly #pendingCommunitySources = new Map<string, PendingPath>()
  readonly #pendingPortable = new Map<string, PendingPath & { readonly sha256: string; readonly target: PortablePluginTarget }>()

  constructor(
    presentation: DesktopDataHomeChooserPresentation,
    options: {
      readonly currentDataHome?: string
      readonly now: () => number
      readonly createSelectionId: () => string
      readonly selectionLifetimeMs: number
    },
  ) {
    this.presentation = presentation
    this.#currentDataHome = options.currentDataHome
    this.#now = options.now
    this.#createSelectionId = options.createSelectionId
    this.#selectionLifetimeMs = options.selectionLifetimeMs
  }

  async chooseSource(
    origin: DesktopDataHomeSourceKind,
    candidate: string | undefined,
    confirmUnidentifiedCommunity = false,
  ): Promise<DesktopDataHomeSourceResult> {
    if (candidate === undefined) return { status: 'cancelled' }
    try {
      let source = await (origin === 'community'
        ? resolveCommunityDataHomeSource(candidate)
        : resolveDesktopDataHomeSource(candidate))
      if (source === undefined && origin === 'community') {
        source = await resolveUnidentifiedCommunityDataHomeSource(candidate)
        if (source !== undefined) {
          if (!confirmUnidentifiedCommunity) {
            return { status: 'confirmation-required', path: source.path, entries: source.entries }
          }
          const selectionId = this.#remember(this.#pendingCommunitySources, source.path)
          return { status: 'valid', path: source.path, entries: source.entries, selectionId }
        }
      }
      return source === undefined
        ? { status: 'invalid', path: candidate }
        : { status: 'valid', path: source.path, entries: source.entries }
    } catch {
      return { status: 'unreadable', path: candidate }
    }
  }

  async chooseTarget(candidate: string | undefined): Promise<DesktopDataHomeTargetResult> {
    if (candidate === undefined) return { status: 'cancelled' }
    let path: string | undefined
    try {
      path = await resolveEmptyDesktopDataHome(candidate)
    } catch {
      return { status: 'unreadable', path: candidate }
    }
    if (path === undefined) return { status: 'not-empty', path: candidate }
    return { status: 'selected', selectionId: this.#remember(this.#pendingTargets, path), path }
  }

  async choosePortable(candidate: string | undefined): Promise<DesktopDataHomePortableResult> {
    if (candidate === undefined) return { status: 'cancelled' }
    try {
      const inspection = await inspectPortablePluginTransfer(candidate)
      const selectionId = this.#createSelectionId()
      this.#pendingPortable.set(selectionId, {
        path: candidate, sha256: inspection.sha256, target: inspection.target,
        expiresAt: this.#now() + this.#selectionLifetimeMs,
      })
      return { status: 'selected', selectionId, target: inspection.target }
    } catch {
      return { status: 'invalid' }
    }
  }

  async submit(value: unknown): Promise<DesktopDataHomeSubmission> {
    if (!isDataHomeChoiceRequest(value)) return { status: 'ignored' }
    let source: DesktopDataHomeSource | undefined
    if (value.mode !== 'fresh') {
      try {
        source = await (value.sourceKind === 'community'
          ? resolveCommunityDataHomeSource(value.source)
          : resolveDesktopDataHomeSource(value.source))
        if (source === undefined && value.sourceKind === 'community' && value.sourceSelectionId !== undefined) {
          const pending = this.#pendingCommunitySources.get(value.sourceSelectionId)
          if (this.#valid(pending, value.source)) source = await resolveUnidentifiedCommunityDataHomeSource(value.source)
        }
      } catch {
        return { status: 'source-error', result: { status: 'unreadable', path: value.source } }
      }
      if (source === undefined) {
        return { status: 'source-error', result: { status: 'invalid', path: value.source } }
      }
    }
    if (value.mode === 'reused') {
      if (source === undefined) return { status: 'ignored' }
      if (value.sourceSelectionId !== undefined) {
        await ensureCommunityProfileIdentity(source.path)
        this.#pendingCommunitySources.delete(value.sourceSelectionId)
      }
      return { status: 'selected', choice: { mode: 'reused', sourceKind: 'community', source: source.path } }
    }
    if (source !== undefined && this.#currentDataHome !== undefined
      && desktopDataHomesOverlap(this.#currentDataHome, source.path)) {
      return { status: 'source-error', result: { status: 'invalid', path: source.path } }
    }
    let target = this.presentation.defaultTarget
    let customTarget = false
    if (value.target.kind === 'default' && !this.presentation.defaultTargetAvailable) {
      return { status: 'target-error', result: { status: 'not-empty', path: target } }
    }
    if (value.target.kind === 'custom') {
      const pending = this.#pendingTargets.get(value.target.selectionId)
      if (!this.#valid(pending)) {
        this.#pendingTargets.delete(value.target.selectionId)
        return { status: 'target-error', result: { status: 'unreadable', path: '' } }
      }
      this.#pendingTargets.delete(value.target.selectionId)
      try {
        const resolved = await resolveEmptyDesktopDataHome(pending.path)
        if (resolved === undefined) {
          return { status: 'target-error', result: { status: 'not-empty', path: pending.path } }
        }
        target = resolved
        customTarget = true
      } catch {
        return { status: 'target-error', result: { status: 'unreadable', path: pending.path } }
      }
    }
    if (value.mode === 'copied' && source !== undefined && desktopDataHomesOverlap(source.path, target)) {
      return { status: 'target-error', result: { status: 'overlap', path: target } }
    }
    if (this.#currentDataHome !== undefined && desktopDataHomesOverlap(this.#currentDataHome, target)) {
      return { status: 'target-error', result: { status: 'overlap', path: target } }
    }
    if (value.mode === 'fresh') {
      return { status: 'selected', choice: { mode: 'fresh', target, customTarget } }
    }
    if (source === undefined) return { status: 'ignored' }
    let portableTransfer: { readonly path: string; readonly sha256: string } | undefined
    if (value.pluginMigration?.mode === 'offline') {
      const pending = this.#pendingPortable.get(value.pluginMigration.selectionId)
      if (!this.#valid(pending)) return { status: 'ignored' }
      portableTransfer = { path: pending.path, sha256: pending.sha256 }
      this.#pendingPortable.delete(value.pluginMigration.selectionId)
    }
    if (value.sourceSelectionId !== undefined) this.#pendingCommunitySources.delete(value.sourceSelectionId)
    return {
      status: 'selected',
      choice: { mode: 'copied', sourceKind: value.sourceKind, source: source.path, target, customTarget,
        ...(portableTransfer === undefined ? {} : { portableTransfer }) },
    }
  }

  clear(): void {
    this.#pendingTargets.clear()
    this.#pendingCommunitySources.clear()
    this.#pendingPortable.clear()
  }

  #remember(store: Map<string, PendingPath>, path: string): string {
    const now = this.#now()
    for (const [id, pending] of store) if (pending.expiresAt < now) store.delete(id)
    const id = this.#createSelectionId()
    store.set(id, { path, expiresAt: now + this.#selectionLifetimeMs })
    return id
  }

  #valid(pending: PendingPath | undefined, expectedPath?: string): pending is PendingPath {
    return pending !== undefined && pending.expiresAt >= this.#now()
      && (expectedPath === undefined || pending.path === expectedPath)
  }
}

/** Deep module for every Desktop-owned data-home lifecycle. */
export class DesktopDataHomeAuthority {
  readonly #options: DesktopDataHomeAuthorityOptions
  readonly #now: () => number
  readonly #createSelectionId: () => string
  readonly #selectionLifetimeMs: number
  readonly #pendingSelections = new Map<string, PendingRendererPath>()

  constructor(options: DesktopDataHomeAuthorityOptions) {
    this.#options = options
    this.#now = options.now ?? (() => Date.now())
    this.#createSelectionId = options.createSelectionId ?? (() => randomUUID())
    this.#selectionLifetimeMs = options.selectionLifetimeMs ?? DEFAULT_SELECTION_LIFETIME_MS
  }

  status(activeHome: string): Promise<DesktopDataHomeStatus> {
    return inspectDesktopDataHomeStatus(this.#options.layout, activeHome)
  }

  async initialize(
    choose: (session: DesktopDataHomeChooserSession) => Promise<DesktopDataHomeChoice>,
  ): Promise<DesktopDataHomeInitializationResult> {
    const layout = this.#options.layout
    let previous = await readDesktopDataHomeSetup(layout.setupFile)
    if (previous?.mode === 'imported'
      && previous.importedOnboardingReset !== IMPORTED_ONBOARDING_RESET_VERSION) {
      await resetImportedDesktopOnboarding(previous.dshHome)
      previous = { ...previous, importedOnboardingReset: IMPORTED_ONBOARDING_RESET_VERSION }
      await writeDesktopDataHomeSetup(layout.setupFile, previous)
    }
    if (layout.explicitDshHome) {
      await writeDesktopDataHomeSetup(layout.setupFile, desktopDataHomeSetup('explicit', layout.dshHome))
      return { path: layout.dshHome, copied: false }
    }
    const recordedHome = resolveRecordedDesktopDataHome(layout, previous)
    if (recordedHome !== undefined && previous?.mode !== 'reused') {
      await ensureCommunityProfileIdentity(recordedHome)
      return { path: recordedHome, copied: false }
    }
    if (recordedHome !== undefined) {
      try {
        const recordedSource = await resolveDesktopDataHomeSource(recordedHome)
        if (recordedSource?.path === recordedHome) return { path: recordedHome, copied: false }
      } catch {
        // An unreadable reused source returns to the chooser.
      }
    }
    if (await hasDesktopData(layout.dshHome)) {
      await ensureCommunityProfileIdentity(layout.dshHome)
      await writeDesktopDataHomeSetup(layout.setupFile, desktopDataHomeSetup('existing', layout.dshHome))
      return { path: layout.dshHome, copied: false }
    }
    const session = await this.#createChooserSession(layout.dshHome, false)
    const choice = await choose(session)
    const prepared = await this.#prepareChoice(choice)
    await writeDesktopDataHomeSetup(layout.setupFile, prepared.setup)
    return { path: prepared.path, copied: prepared.copied }
  }

  async change(
    activeHome: string,
    choose: (session: DesktopDataHomeChooserSession) => Promise<DesktopDataHomeChoice>,
  ): Promise<DesktopDataHomeSwitchResult> {
    if (this.#options.layout.explicitDshHome) {
      throw new Error('desktop: DSH_HOME is managed by the launch environment')
    }
    const status = await this.status(activeHome)
    const session = await this.#createChooserSession(status.desktopPath, true, activeHome)
    const prepared = await this.#prepareChoice(await choose(session))
    if (desktopDataHomesOverlap(prepared.path, activeHome)) {
      return { restarting: false, activePath: activeHome }
    }
    await this.#publishAndRestart(prepared.setup)
    return { restarting: true, activePath: prepared.path }
  }

  async chooseDirectory(
    rendererId: number,
    selectionKind: DesktopDataHomeSelectionKind,
    candidate: string | undefined,
  ): Promise<DesktopDataHomeSelectionResult> {
    if (candidate === undefined) return { status: 'cancelled' }
    let selectedPath: string | undefined
    let entries: readonly string[] = []
    try {
      if (selectionKind === 'empty') {
        selectedPath = await resolveEmptyDesktopDataHome(candidate)
        if (selectedPath === undefined) return { status: 'not-empty', path: candidate }
      } else {
        const source = await resolveDesktopDataHomeSource(candidate)
        if (source === undefined) return { status: 'invalid', path: candidate }
        selectedPath = source.path
        entries = source.entries
      }
    } catch {
      return { status: 'unreadable', path: candidate }
    }
    return this.#rememberRendererSelection(rendererId, selectionKind, selectedPath, entries)
  }

  async chooseRecoveryDirectory(
    rendererId: number,
    candidate: string | undefined,
  ): Promise<DesktopDataHomeSelectionResult> {
    if (candidate === undefined) return { status: 'cancelled' }
    let selection
    try {
      selection = await resolveDesktopDataHomeRecoverySelection(candidate)
    } catch {
      return { status: 'unreadable', path: candidate }
    }
    if (selection === undefined) return { status: 'invalid', path: candidate }
    return this.#rememberRendererSelection(
      rendererId,
      selection.kind,
      selection.path,
      selection.kind === 'existing' ? selection.entries : [],
    )
  }

  async switch(
    activeHome: string,
    rendererId: number,
    request: unknown,
  ): Promise<DesktopDataHomeSwitchResult> {
    if (!isSwitchRequest(request)) throw new TypeError('desktop: invalid data-home switch request')
    let target: { readonly kind: 'desktop' }
      | { readonly kind: 'official' }
      | { readonly kind: 'custom' | 'create'; readonly path: string }
    if (request.kind === 'custom' || request.kind === 'create') {
      const pending = this.#pendingSelections.get(request.selectionId)
      const expectedKind: DesktopDataHomeSelectionKind = request.kind === 'create' ? 'empty' : 'existing'
      if (pending === undefined || pending.rendererId !== rendererId || pending.selectionKind !== expectedKind
        || pending.expiresAt <= this.#now()) {
        this.#pendingSelections.delete(request.selectionId)
        throw new Error('desktop: selected data directory expired; choose it again')
      }
      target = { kind: request.kind, path: pending.path }
    } else target = request
    const decision = await resolveDesktopDataHomeSwitch(this.#options.layout, activeHome, target)
    if (request.kind === 'custom' || request.kind === 'create') this.#pendingSelections.delete(request.selectionId)
    if (!decision.changed) return { restarting: false, activePath: activeHome }
    await this.#publishAndRestart(decision.setup)
    return { restarting: true, activePath: decision.path }
  }

  async #createChooserSession(
    defaultTarget: string,
    returnToMain: boolean,
    currentDataHome?: string,
  ): Promise<DesktopDataHomeChooserSession> {
    const layout = this.#options.layout
    let officialSource: DesktopDataHomeSource | undefined
    let officialSourceUnreadable = false
    try { officialSource = await resolveDesktopDataHomeSource(layout.officialDshHome) } catch { officialSourceUnreadable = true }
    let communitySource: DesktopDataHomeSource | undefined
    let communitySourceUnreadable = false
    try {
      if (currentDataHome !== undefined) communitySource = await resolveCommunityDataHomeSource(currentDataHome)
      if (communitySource === undefined) communitySource = await resolveCommunityDataHomeSource(layout.communityDesktopRoot)
    } catch { communitySourceUnreadable = true }
    const defaultTargetAvailable = currentDataHome === undefined
      || (!desktopDataHomesOverlap(defaultTarget, currentDataHome) && !await hasDesktopData(defaultTarget))
    return new DesktopDataHomeChooserSession({
      ...(officialSource === undefined ? {} : { officialSource }),
      officialSourceUnreadable,
      officialSourceCandidate: layout.officialDshHome,
      ...(communitySource === undefined ? {} : { communitySource }),
      communitySourceUnreadable,
      communitySourceCandidate: communitySource?.path ?? layout.communityDesktopRoot,
      defaultTarget,
      returnToMain,
      defaultTargetAvailable,
    }, {
      ...(currentDataHome === undefined ? {} : { currentDataHome }),
      now: this.#now,
      createSelectionId: this.#createSelectionId,
      selectionLifetimeMs: this.#selectionLifetimeMs,
    })
  }

  async #prepareChoice(selection: DesktopDataHomeChoice): Promise<PreparedDataHomeChoice> {
    if (selection.mode === 'copied') {
      if (selection.sourceKind === 'official') await importOfficialDesktopData(selection.source, selection.target, selection.portableTransfer)
      else await copyCommunityDesktopData(selection.source, selection.target, selection.portableTransfer)
      await ensureCommunityProfileIdentity(selection.target)
      return {
        path: selection.target,
        setup: desktopDataHomeSetup(
          selection.sourceKind === 'official' ? 'imported' : 'copied',
          selection.target,
          selection.source,
        ),
        copied: true,
      }
    }
    if (selection.mode === 'reused') {
      await ensureCommunityProfileIdentity(selection.source)
      return {
        path: selection.source,
        setup: desktopDataHomeSetup('reused', selection.source, selection.source),
        copied: false,
      }
    }
    if (await hasDesktopData(selection.target)) {
      throw new Error(`desktop: refusing to initialize non-empty Harness home ${selection.target}`)
    }
    await ensureCommunityProfileIdentity(selection.target)
    return {
      path: selection.target,
      setup: desktopDataHomeSetup(selection.customTarget ? 'created' : 'fresh', selection.target),
      copied: false,
    }
  }

  #rememberRendererSelection(
    rendererId: number,
    selectionKind: DesktopDataHomeSelectionKind,
    path: string,
    entries: readonly string[],
  ): DesktopDataHomeSelectionResult {
    const now = this.#now()
    for (const [id, pending] of this.#pendingSelections) {
      if (pending.expiresAt <= now || pending.rendererId === rendererId) this.#pendingSelections.delete(id)
    }
    const selectionId = this.#createSelectionId()
    this.#pendingSelections.set(selectionId, {
      rendererId, selectionKind, path, expiresAt: now + this.#selectionLifetimeMs,
    })
    return { status: 'selected', selectionKind, selectionId, path, entries }
  }

  async #publishAndRestart(setup: DesktopDataHomeSetup): Promise<void> {
    await this.#options.stopActiveProfile()
    await writeDesktopDataHomeSetup(this.#options.layout.setupFile, setup)
    this.#options.scheduleRestart()
  }
}
