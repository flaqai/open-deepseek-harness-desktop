/** Sandboxed interaction controller for the first-run data-home chooser. */

import { ipcRenderer } from 'electron'
import {
  DESKTOP_LOCALES,
  resolveDesktopLocale,
  type DesktopLocaleId,
} from './desktop-locale.ts'
import { copyFor, detailsFor } from './locales/data-home.ts'
import { sourceCopyFor } from './locales/data-home-source.ts'
import { portableCopyFor } from './locales/data-home-portable.ts'

type DataHomeMode = 'imported' | 'reused' | 'fresh'

type DataHomeSourceResult =
  | {
    readonly status: 'valid'
    readonly path: string
    readonly entries: readonly string[]
    readonly selectionId?: string
  }
  | { readonly status: 'invalid' | 'unreadable'; readonly path: string }
  | { readonly status: 'cancelled' }

type DataHomeTargetResult =
  | { readonly status: 'selected'; readonly selectionId: string; readonly path: string }
  | { readonly status: 'not-empty' | 'overlap' | 'unreadable'; readonly path: string }
  | { readonly status: 'cancelled' }

type DataHomeTargetMode = 'default' | 'custom'
type DataHomeStep = 'details' | 'operation' | 'plugins' | 'destination'
type SourceCategory = 'official' | 'community' | 'fresh'

function isDataHomeMode(value: string | null): value is DataHomeMode {
  return value === 'imported' || value === 'reused' || value === 'fresh'
}

// Copy is owned by complete, typed locale dictionaries.

function required(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (element === null) throw new Error(`desktop: data-home chooser is missing ${selector}`)
  return element
}

window.addEventListener('DOMContentLoaded', () => {
  const startupLocale = new URLSearchParams(window.location.search).get('locale')
  let language = resolveDesktopLocale(startupLocale ?? navigator.languages)
  const help = required('#help') as HTMLButtonElement
  const close = required('#close-comparison') as HTMLButtonElement
  const choicesGroup = required('#choices')
  const sourceViews = {
    official: {
      panel: required('#official-source'),
      status: required('#official-source-status'),
      path: required('#official-source-path'),
      summary: required('#official-source-summary'),
      error: required('#official-source-error'),
      button: required('#choose-official-source') as HTMLButtonElement,
    },
    community: {
      panel: required('#community-source'),
      status: required('#community-source-status'),
      path: required('#community-source-path'),
      summary: required('#community-source-summary'),
      error: required('#community-source-error'),
      button: required('#choose-community-source') as HTMLButtonElement,
    },
  }
  const sourceRequirements = [...document.querySelectorAll<HTMLElement>('.choice-requirement')]
  const languagePicker = required('#language-picker')
  const languageTrigger = required('#language-trigger') as HTMLButtonElement
  const languageMenu = required('#language-menu')
  const languageCurrent = required('#language-current')
  const languageOptions = DESKTOP_LOCALES.map(({ id, label }) => {
    const option = document.createElement('button')
    option.className = 'language-option'
    option.type = 'button'
    option.role = 'option'
    option.dataset.language = id
    const name = document.createElement('span')
    name.textContent = label
    const code = document.createElement('span')
    code.className = 'language-code'
    code.textContent = id.toUpperCase()
    option.append(name, code)
    return option
  })
  languageMenu.replaceChildren(...languageOptions)
  const developmentTools = required('#development-tools')
  const simulateMissingSourceButton = required('#simulate-missing-source') as HTMLButtonElement

  const choices = [...document.querySelectorAll<HTMLButtonElement>('.choice')]
  const overlay = required('#overlay')
  const detailPanel = required('#detail')
  const detailTitle = required('#detail-title')
  const detailStage = required('#detail-stage')
  const facts = required('#facts')
  const operationPanel = required('#operation-panel')
  const operationChoices = [...document.querySelectorAll<HTMLButtonElement>('[data-operation]')]
  const reuseOperationChoice = required('[data-operation="reused"]') as HTMLButtonElement
  const independentOperationTitle = required('[data-operation-copy="importTitle"]')
  const operationSummary = required('.operation-panel .destination-summary')
  const copyOperationSummary = required('#copy-operation-summary')
  const reuseOperationSummary = required('#reuse-operation-summary')
  const destinationPanel = required('#destination-panel')
  const portablePanel = required('#portable-panel')
  const migrationChoices = [...document.querySelectorAll<HTMLButtonElement>('[data-migration]')]
  const portableSelection = required('#portable-selection')
  const portableTarget = required('#portable-target')
  const portableError = required('#portable-error')
  const choosePortableButton = required('#choose-portable') as HTMLButtonElement
  const destinationSummary = required('#destination-summary')
  const targetChoicesGroup = required('#target-choices')
  const targetChoices = [...document.querySelectorAll<HTMLElement>('[data-target]')]
  const defaultTargetChoice = required('[data-target="default"]')
  const defaultTargetPath = required('#default-target-path')
  const customTargetPath = required('#custom-target-path')
  const customTargetError = required('#custom-target-error')
  const chooseTargetButton = required('#choose-target') as HTMLButtonElement
  const backButton = required('#back') as HTMLButtonElement
  const returnMainButton = required('#return-main') as HTMLButtonElement
  const continueButton = required('#continue') as HTMLButtonElement
  const risk = required('#risk')
  const comparisonTitle = required('#comparison-title')
  const comparisonHead = required('#comparison-head')
  const comparisonBody = required('#comparison-body')
  const comparisonNote = required('.comparison-note')
  const location = required('#location-value')
  const sharing = required('#sharing-value')
  const plugins = required('#plugins-value')
  const builds = required('#builds-value')
  const parameters = new URLSearchParams(window.location.search)
  const currentHost = [parameters.get('hostPlatform'), parameters.get('hostArchitecture'), parameters.get('hostOsVersion')]
    .every(value => value !== null && value !== '')
    ? `${parameters.get('hostPlatform')}/${parameters.get('hostArchitecture')} · ${parameters.get('hostOsVersion')}` : undefined
  const development = parameters.get('development') === 'true'
  const returnToMain = parameters.get('returnToMain') === 'true'
  const defaultTargetAvailable = parameters.get('defaultTargetAvailable') !== 'false'
  const requestedMode = parameters.get('selected')
  const selectedSource = parameters.get('selectedSource') === 'community' ? 'community' : 'official'
  const officialSource = parameters.get('officialSource')?.trim() || undefined
  const communitySource = parameters.get('communitySource')?.trim() || undefined
  const builtInTarget = parameters.get('defaultTarget')?.trim() || ''
  type SourceState = 'valid' | 'missing' | 'unreadable'
  type ExistingSourceCategory = 'official' | 'community'
  type SourceEntry = {
    path: string | undefined
    status: SourceState
    readonly defaultPath: string | undefined
    readonly candidate: string | undefined
    error: 'invalid' | 'unreadable' | undefined
    selectionId: string | undefined
  }
  let selected: DataHomeMode = isDataHomeMode(requestedMode) ? requestedMode : 'imported'
  let origin: SourceCategory = selected === 'fresh' ? 'fresh' : selectedSource
  const sourceState = (path: string | undefined, parameter: string | null): SourceState =>
    parameter === 'unreadable' ? 'unreadable' : path === undefined ? 'missing' : 'valid'
  const sources: Record<ExistingSourceCategory, SourceEntry> = {
    official: {
      path: officialSource,
      status: sourceState(officialSource, parameters.get('officialSourceStatus')),
      defaultPath: parameters.get('officialDefaultSource')?.trim() || undefined,
      candidate: parameters.get('officialSourceCandidate')?.trim() || undefined,
      error: undefined,
      selectionId: undefined,
    },
    community: {
      path: communitySource,
      status: sourceState(communitySource, parameters.get('communitySourceStatus')),
      defaultPath: parameters.get('communityDefaultSource')?.trim() || undefined,
      candidate: parameters.get('communitySourceCandidate')?.trim() || undefined,
      error: undefined,
      selectionId: undefined,
    },
  }
  let source = origin === 'fresh' ? undefined : sources[origin].path
  let sourceSelectionPending = false
  let submitting = false
  let step: DataHomeStep = 'details'
  let targetMode: DataHomeTargetMode = defaultTargetAvailable ? 'default' : 'custom'
  let customTarget: { readonly selectionId: string; readonly path: string } | undefined
  let targetErrorKind: 'not-empty' | 'overlap' | 'unreadable' | undefined
  let migrationMode: 'online' | 'offline' = 'online'
  let portableBundle: { selectionId: string; target: { platform: string; architecture: string; osVersion: string } } | undefined
  let portableInvalid = false
  let portableChecking = false
  let simulateMissingSource = false
  let selectionBeforeSimulation: SourceCategory | undefined

  developmentTools.hidden = !development
  returnMainButton.hidden = !returnToMain
  defaultTargetChoice.hidden = !defaultTargetAvailable

  const displayedSource = (): string | undefined =>
    origin === 'official' && simulateMissingSource ? undefined : source

  const renderSource = (): void => {
    const copy = copyFor(language)
    const sourceCopy = sourceCopyFor(language)
    independentOperationTitle.textContent = origin === 'official'
      ? sourceCopy.officialImportTitle : copyFor(language).importTitle
    for (const category of ['official', 'community'] as const) {
      const entry = sources[category]
      const view = sourceViews[category]
      const simulated = category === 'official' && simulateMissingSource
      const visiblePath = simulated ? undefined : entry.path
      const visibleStatus = simulated ? 'missing' : entry.status
      const usingCustomSource = visiblePath !== undefined && visiblePath !== entry.defaultPath
      view.panel.dataset.status = visibleStatus
      const categoryTitle = category === 'official' ? sourceCopy.officialCardTitle : sourceCopy.communityCardTitle
      const statusText = visibleStatus === 'unreadable'
        ? copy.sourceUnreadable
        : visiblePath === undefined ? sourceCopy.notDetected : sourceCopy.detected
      view.status.textContent = `${categoryTitle} · ${statusText}`
      const displayedPath = visiblePath ?? (visibleStatus === 'unreadable' ? entry.candidate : undefined)
      view.path.textContent = displayedPath ?? ''
      view.path.hidden = displayedPath === undefined
      view.summary.textContent = visibleStatus === 'unreadable'
        ? copy.sourceUnreadableSummary
        : visiblePath === undefined ? sourceCopy.selectHint : usingCustomSource ? copy.sourceCustom : ''
      view.summary.hidden = view.summary.textContent.length === 0
      const error = simulated ? undefined : entry.error
      view.error.textContent = error === 'invalid'
        ? category === 'community' ? sourceCopy.communitySourceInvalid : copy.sourceInvalid
        : error === 'unreadable' ? copy.sourceReadFailed : ''
      view.error.hidden = error === undefined
      view.button.textContent = category === 'official' ? sourceCopy.chooseOfficial : sourceCopy.chooseCommunity
      view.button.disabled = sourceSelectionPending || submitting
    }
    for (const requirement of sourceRequirements) {
      const category = requirement.closest<HTMLElement>('[data-source]')?.dataset.source
      requirement.hidden = category === 'official' ? !simulateMissingSource && sources.official.path !== undefined : sources.community.path !== undefined
    }
    simulateMissingSourceButton.textContent = simulateMissingSource ? copy.restoreDetectedSource : copy.simulateMissingSource
    simulateMissingSourceButton.ariaPressed = String(simulateMissingSource)
  }

  const selectedTargetPath = (): string | undefined => targetMode === 'default'
    ? builtInTarget || undefined
    : customTarget?.path

  const renderDestination = (): void => {
    const copy = copyFor(language)
    targetChoicesGroup.ariaLabel = copy.targetGroupLabel
    defaultTargetPath.textContent = builtInTarget
    defaultTargetPath.hidden = builtInTarget.length === 0
    customTargetPath.textContent = customTarget?.path ?? ''
    customTargetPath.hidden = customTarget === undefined
    chooseTargetButton.textContent = customTarget === undefined ? copy.chooseTarget : copy.changeTarget
    customTargetError.textContent = targetErrorKind === 'not-empty'
      ? copy.targetNotEmpty
      : targetErrorKind === 'overlap' ? copy.targetOverlap
        : targetErrorKind === 'unreadable' ? copy.targetUnreadable : targetMode === 'custom' && customTarget === undefined
          ? copy.targetRequired
          : ''
    customTargetError.hidden = customTargetError.textContent.length === 0
    for (const choice of targetChoices) choice.ariaChecked = String(choice.dataset.target === targetMode)
    continueButton.disabled = targetMode === 'custom' && customTarget === undefined
  }

  const renderStep = (): void => {
    const destinationVisible = step === 'destination'
    const operationVisible = step === 'operation'
    const portableVisible = step === 'plugins'
    const detail = detailsFor(language)[selected]
    const sourceCopy = sourceCopyFor(language)
    operationSummary.textContent = origin === 'official'
      ? sourceCopy.officialOperationSummary : sourceCopy.operationSummary
    copyOperationSummary.textContent = origin === 'community'
      ? sourceCopy.communityCopySummary : sourceCopy.officialCopySummary
    reuseOperationSummary.textContent = origin === 'community'
      ? sourceCopy.communityReuseSummary : sourceCopy.officialReuseSummary
    const directUseWarning = selected === 'reused' && origin === 'official'
      ? sourceCopy.officialReuseSummary : ''
    risk.textContent = directUseWarning
    risk.hidden = !operationVisible || !directUseWarning
    backButton.hidden = step === 'details'
    detailStage.dataset.step = step
    facts.inert = step !== 'details'
    facts.ariaHidden = String(step !== 'details')
    operationPanel.inert = !operationVisible
    operationPanel.ariaHidden = String(!operationVisible)
    portablePanel.inert = !portableVisible
    portablePanel.ariaHidden = String(!portableVisible)
    destinationPanel.ariaHidden = String(!destinationVisible)
    destinationPanel.inert = !destinationVisible
    for (const choice of operationChoices) choice.ariaChecked = String(choice.dataset.operation === selected)
    const portableCopy = portableCopyFor(language)
    required('#portable-title').textContent = portableCopy.title
    required('#portable-summary').textContent = portableCopy.summary
    required('#portable-current-host').textContent = currentHost === undefined ? '' : `${portableCopy.currentHost}: ${currentHost}`
    required('#portable-online-title').textContent = portableCopy.online
    required('#portable-online-detail').textContent = portableCopy.onlineDetail
    required('#portable-offline-title').textContent = portableCopy.offline
    required('#portable-offline-detail').textContent = portableCopy.offlineDetail
    for (const choice of migrationChoices) choice.ariaChecked = String(choice.dataset.migration === migrationMode)
    portableSelection.hidden = migrationMode !== 'offline'
    choosePortableButton.textContent = portableChecking ? portableCopy.checking : portableCopy.choose
    choosePortableButton.disabled = portableChecking || submitting
    portableTarget.textContent = portableBundle === undefined ? ''
      : `${portableCopy.selected}: ${portableBundle.target.platform}/${portableBundle.target.architecture} · ${portableBundle.target.osVersion}`
    portableError.textContent = portableInvalid ? portableCopy.invalid
      : migrationMode === 'offline' && portableBundle === undefined ? portableCopy.required : ''
    portableError.hidden = portableError.textContent.length === 0
    reuseOperationChoice.hidden = origin === 'official'
    required('#operation-sharing').textContent = detail.sharing
    required('#operation-plugins').textContent = detail.plugins
    required('#operation-builds').textContent = detail.builds
    continueButton.textContent = destinationVisible || (operationVisible && selected === 'reused')
      ? sourceCopy.start : copyFor(language).continue
    if (destinationVisible) {
      destinationSummary.textContent = copyFor(language).destinationSummary
      renderDestination()
    } else {
      continueButton.disabled = false
    }
    continueButton.disabled ||= sourceSelectionPending || submitting || portableChecking
      || (portableVisible && migrationMode === 'offline' && portableBundle === undefined)
  }

  const renderCopy = (): void => {
    const original = copyFor(language)
    const sourceCopy = sourceCopyFor(language)
    const copy = {
      ...original, ...sourceCopy,
      importTitle: sourceCopy.officialTitle, importSummary: sourceCopy.officialSummary,
      reuseTitle: sourceCopy.communityTitle, reuseSummary: sourceCopy.communitySummary,
      compareImportLocation: sourceCopy.officialLocation, compareReuseLocation: sourceCopy.communityLocation,
      compareImportSharing: sourceCopy.retainedData, compareReuseSharing: sourceCopy.retainedData,
      compareImportPlugins: sourceCopy.retainedPlugins, compareReusePlugins: sourceCopy.retainedPlugins,
      compareImportSuitable: sourceCopy.officialSuitable, compareReuseSuitable: sourceCopy.communitySuitable,
      comparisonNote: sourceCopy.comparisonNote,
    }
    for (const element of document.querySelectorAll<HTMLElement>('[data-operation-copy]')) {
      element.textContent = original[element.dataset.operationCopy as keyof typeof original]
    }
    document.documentElement.lang = language
    document.title = copy.windowTitle
    languageCurrent.textContent = DESKTOP_LOCALES.find(locale => locale.id === language)?.label ?? 'English'
    languageTrigger.ariaLabel = `${copy.languageLabel}: ${languageCurrent.textContent}`
    languageMenu.ariaLabel = copy.languageLabel
    for (const option of languageOptions) option.ariaSelected = String(option.dataset.language === language)
    help.ariaLabel = copy.helpLabel
    close.ariaLabel = copy.closeLabel
    choicesGroup.ariaLabel = copy.modeGroupLabel
    for (const element of document.querySelectorAll<HTMLElement>('[data-copy]')) {
      const key = element.dataset.copy as keyof typeof copy
      element.textContent = copy[key]
    }
    renderSource()
    renderDestination()
  }

  const select = (mode: DataHomeMode): void => {
    selected = mode
    for (const choice of choices) choice.ariaChecked = String(choice.dataset.source === origin)
    detailPanel.dataset.source = origin
    const copy = sourceCopyFor(language)
    const detail = origin === 'fresh' ? detailsFor(language).fresh : {
      title: origin === 'official' ? copy.officialTitle : copy.communityTitle,
      location: origin === 'official' ? copy.officialLocation : copy.communityLocation,
      sharing: origin === 'official' ? copyFor(language).compareImportLocation : copy.retainedData,
      plugins: origin === 'official' ? copyFor(language).compareImportPlugins : copy.retainedPlugins,
      builds: copy.builds, risk: undefined,
    }
    detailTitle.textContent = detail.title
    risk.textContent = detail.risk ?? ''
    risk.hidden = detail.risk === undefined
    location.textContent = detail.location
    sharing.textContent = detail.sharing
    plugins.textContent = detail.plugins
    builds.textContent = detail.builds
    renderStep()
  }

  const enterDestinationStep = (): void => {
    step = 'destination'
    renderStep()
    targetChoices.find(choice => choice.dataset.target === targetMode)?.focus()
  }

  const enterPortableStep = (): void => {
    step = 'plugins'
    renderStep()
    migrationChoices.find(choice => choice.dataset.migration === migrationMode)?.focus()
  }

  const leaveDestinationStep = (): void => {
    step = step === 'destination' && origin !== 'fresh' ? 'plugins'
      : step === 'plugins' && origin === 'community' ? 'operation' : 'details'
    renderStep()
    if (step === 'operation') operationChoices.find(choice => choice.dataset.operation === selected)?.focus()
    else if (step === 'plugins') migrationChoices.find(choice => choice.dataset.migration === migrationMode)?.focus()
    else choices.find(choice => choice.dataset.source === origin)?.focus()
  }

  const choosePortable = async (): Promise<void> => {
    if (submitting || portableChecking) return
    portableChecking = true
    portableInvalid = false
    renderStep()
    try {
      const result = await ipcRenderer.invoke('dsh:data-home:choose-portable') as
        | { status: 'selected'; selectionId: string; target: { platform: string; architecture: string; osVersion: string } }
        | { status: 'invalid' | 'unreadable' | 'cancelled' }
      if (result.status === 'selected') portableBundle = { selectionId: result.selectionId, target: result.target }
      else if (result.status !== 'cancelled') { portableBundle = undefined; portableInvalid = true }
    } catch {
      portableBundle = undefined
      portableInvalid = true
    } finally {
      portableChecking = false
      renderStep()
    }
  }
  const chooseSource = async (category: ExistingSourceCategory): Promise<void> => {
    if (sourceSelectionPending || submitting) return
    if (origin !== category) selectOrigin(category)
    sourceSelectionPending = true
    for (const choice of choices) choice.disabled = true
    renderStep()
    sources[category].error = undefined
    renderSource()
    try {
      const result = await ipcRenderer.invoke('dsh:data-home:choose-source', category) as DataHomeSourceResult
      if (result.status === 'cancelled') return
      if (result.status !== 'valid') {
        simulateMissingSource = false
        selectionBeforeSimulation = undefined
        sources[category].error = result.status
        sources[category].selectionId = undefined
        renderSource()
        return
      }
      simulateMissingSource = false
      selectionBeforeSimulation = undefined
      source = result.path
      sources[category].path = source
      sources[category].status = 'valid'
      sources[category].error = undefined
      sources[category].selectionId = result.selectionId
      portableBundle = undefined
      portableInvalid = false
      renderSource()
    } catch {
      sources[category].error = 'unreadable'
      renderSource()
    } finally {
      sourceSelectionPending = false
      for (const choice of choices) choice.disabled = false
      renderSource()
      renderStep()
    }
  }
  const chooseTarget = async (): Promise<void> => {
    if (submitting || chooseTargetButton.disabled) return
    chooseTargetButton.disabled = true
    targetErrorKind = undefined
    renderDestination()
    try {
      const result = await ipcRenderer.invoke('dsh:data-home:choose-target') as DataHomeTargetResult
      if (result.status === 'cancelled') return
      if (result.status !== 'selected') {
        customTarget = undefined
        targetErrorKind = result.status
        renderDestination()
        return
      }
      customTarget = { selectionId: result.selectionId, path: result.path }
      targetMode = 'custom'
      targetErrorKind = undefined
      renderDestination()
    } catch {
      customTarget = undefined
      targetErrorKind = 'unreadable'
      renderDestination()
    } finally {
      chooseTargetButton.disabled = false
    }
  }
  const selectOrigin = (category: SourceCategory): void => {
    if (sourceSelectionPending || submitting) return
    origin = category
    portableBundle = undefined
    portableInvalid = false
    source = category === 'fresh' ? undefined : sources[category].path
    step = 'details'
    select(category === 'community' ? 'reused' : category === 'fresh' ? 'fresh' : 'imported')
    renderSource()
  }
  for (const choice of choices) {
    choice.addEventListener('click', () => { selectOrigin(choice.dataset.source as SourceCategory) })
  }
  for (const choice of operationChoices) {
    choice.addEventListener('click', () => {
      if (submitting) return
      select(choice.dataset.operation as 'imported' | 'reused')
    })
  }
  for (const choice of migrationChoices) {
    choice.addEventListener('click', () => {
      if (submitting || portableChecking) return
      migrationMode = choice.dataset.migration === 'offline' ? 'offline' : 'online'
      renderStep()
      if (migrationMode === 'offline' && portableBundle === undefined) choosePortableButton.focus()
    })
  }
  choosePortableButton.addEventListener('click', () => { void choosePortable() })
  for (const choice of targetChoices) {
    choice.addEventListener('click', (event) => {
      if (submitting) return
      if (event.target === chooseTargetButton) return
      const requestedTarget = choice.dataset.target === 'custom' ? 'custom' : 'default'
      targetMode = requestedTarget
      targetErrorKind = undefined
      renderDestination()
      if (requestedTarget === 'custom' && customTarget === undefined) void chooseTarget()
    })
    choice.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      choice.click()
    })
  }
  chooseTargetButton.addEventListener('click', (event) => {
    event.stopPropagation()
    if (submitting) return
    targetMode = 'custom'
    void chooseTarget()
  })
  sourceViews.official.button.addEventListener('click', () => { void chooseSource('official') })
  sourceViews.community.button.addEventListener('click', () => { void chooseSource('community') })
  simulateMissingSourceButton.addEventListener('click', () => {
    if (!development) return
    simulateMissingSource = !simulateMissingSource
    if (simulateMissingSource) {
      selectionBeforeSimulation = origin
      step = 'details'
      selectOrigin('fresh')
    } else if (selectionBeforeSimulation !== undefined) {
      const restoredSelection = selectionBeforeSimulation
      selectionBeforeSimulation = undefined
      step = 'details'
      selectOrigin(restoredSelection)
    }
    renderSource()
  })
  ipcRenderer.on('dsh:data-home:source-error', (_event, result: DataHomeSourceResult) => {
    if (result.status !== 'invalid' && result.status !== 'unreadable') return
    submitting = false
    if (origin !== 'fresh') {
      sources[origin].error = result.status
      sources[origin].selectionId = undefined
    }
    renderSource()
    renderStep()
  })
  ipcRenderer.on('dsh:data-home:target-error', (_event, result: DataHomeTargetResult) => {
    if (result.status !== 'not-empty' && result.status !== 'overlap' && result.status !== 'unreadable') return
    submitting = false
    customTarget = undefined
    targetMode = 'custom'
    targetErrorKind = result.status
    renderStep()
  })

  const closeLanguageMenu = (restoreFocus = false): void => {
    languageMenu.hidden = true
    languageTrigger.ariaExpanded = 'false'
    if (restoreFocus) languageTrigger.focus()
  }
  const openLanguageMenu = (): void => {
    languageMenu.hidden = false
    languageTrigger.ariaExpanded = 'true'
    languageOptions.find(option => option.dataset.language === language)?.focus()
  }
  const changeLanguage = (nextLanguage: DesktopLocaleId): void => {
    language = nextLanguage
    renderCopy()
    select(selected)
    if (!overlay.hidden) renderComparison()
    closeLanguageMenu(true)
  }
  languageTrigger.addEventListener('click', () => {
    if (languageMenu.hidden) openLanguageMenu()
    else closeLanguageMenu()
  })
  languageTrigger.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    openLanguageMenu()
  })
  for (const option of languageOptions) {
    option.addEventListener('click', () => { changeLanguage(resolveDesktopLocale(option.dataset.language ?? 'en')) })
  }
  document.addEventListener('click', (event) => {
    if (!languageMenu.hidden && event.target instanceof Node && !languagePicker.contains(event.target)) closeLanguageMenu()
  })

  interface ComparisonColumn {
    readonly title: string
    readonly tone: 'official' | 'community' | 'fresh' | 'copy' | 'reuse' | 'default' | 'custom'
    readonly values: readonly string[]
  }
  const renderComparisonTable = (
    title: string,
    note: string,
    labels: readonly string[],
    columns: readonly ComparisonColumn[],
    toneKind: 'source' | 'option',
  ): void => {
    comparisonTitle.textContent = title
    comparisonNote.textContent = note
    const headingRow = document.createElement('tr')
    headingRow.append(document.createElement('th'))
    for (const column of columns) {
      const heading = document.createElement('th')
      heading.textContent = column.title
      heading.dataset.mode = column.tone
      heading.dataset[toneKind] = column.tone
      headingRow.append(heading)
    }
    comparisonHead.replaceChildren(headingRow)
    comparisonBody.replaceChildren(...labels.map((label, rowIndex) => {
      const row = document.createElement('tr')
      const heading = document.createElement('th')
      heading.textContent = label
      row.append(heading)
      for (const column of columns) {
        const cell = document.createElement('td')
        cell.textContent = column.values[rowIndex] ?? ''
        cell.style.whiteSpace = 'pre-line'
        row.append(cell)
      }
      return row
    }))
  }
  const renderComparison = (full = false): void => {
    const copy = copyFor(language)
    const sourceCopy = sourceCopyFor(language)
    if (full || step === 'details') {
      renderComparisonTable(copy.comparisonTitle, sourceCopy.comparisonNote, [
        copy.locationLabel, sourceCopy.retentionLabel, copy.pluginsLabel, copy.suitableLabel,
      ], [
        { title: sourceCopy.officialTitle, tone: 'official', values: [
          sourceCopy.officialLocation,
          copy.compareImportLocation,
          copy.compareImportPlugins,
          sourceCopy.officialSuitable,
        ] },
        { title: sourceCopy.communityTitle, tone: 'community', values: [
          sourceCopy.communityLocation,
          `${copy.importTitle}: ${copy.compareImportLocation}\n\n${copy.reuseTitle}: ${sourceCopy.retainedData}`,
          `${copy.importTitle}: ${copy.compareImportPlugins}\n\n${copy.reuseTitle}: ${copy.compareReusePlugins}`,
          sourceCopy.communitySuitable,
        ] },
        { title: copy.freshTitle, tone: 'fresh', values: [
          copy.compareFreshLocation, copy.compareFreshSharing, copy.compareFreshPlugins, copy.compareFreshSuitable,
        ] },
      ], 'source')
      return
    }
    if (step === 'operation') {
      const copied = detailsFor(language).imported
      const reused = detailsFor(language).reused
      const copiedSummary = origin === 'community' ? sourceCopy.communityCopySummary : sourceCopy.officialCopySummary
      const reusedSummary = origin === 'community' ? sourceCopy.communityReuseSummary : sourceCopy.officialReuseSummary
      renderComparisonTable(sourceCopy.operationTitle, origin === 'official'
        ? sourceCopy.officialOperationSummary : sourceCopy.operationSummary, [
        copy.locationLabel, copy.sharingLabel, copy.pluginsLabel, copy.buildsLabel, copy.suitableLabel,
      ], [
        { title: origin === 'official' ? sourceCopy.officialImportTitle : copy.importTitle, tone: 'copy', values: [
          copied.location, copied.sharing,
          copied.plugins, copied.builds, copiedSummary,
        ] },
        { title: copy.reuseTitle, tone: 'reuse', values: [
          reused.location, reused.sharing, reused.plugins, reused.builds, reusedSummary,
        ] },
      ], 'option')
      return
    }
    if (step === 'plugins') {
      const portableCopy = portableCopyFor(language)
      renderComparisonTable(portableCopy.title, portableCopy.summary, [copy.pluginsLabel], [
        { title: portableCopy.online, tone: 'copy', values: [portableCopy.onlineDetail] },
        { title: portableCopy.offline, tone: 'reuse', values: [portableCopy.offlineDetail] },
      ], 'option')
      return
    }
    renderComparisonTable(copy.destinationTitle, copy.destinationSummary, [
      copy.locationLabel, copy.suitableLabel,
    ], [
      { title: copy.defaultTargetTitle, tone: 'default', values: [
        builtInTarget || copy.defaultTargetTitle, copy.defaultTargetSummary,
      ] },
      { title: copy.customTargetTitle, tone: 'custom', values: [
        customTarget?.path ?? copy.chooseTarget, copy.customTargetSummary,
      ] },
    ], 'option')
  }

  let comparisonTrigger: HTMLElement = help
  const showComparison = (full = false): void => {
    closeLanguageMenu()
    comparisonTrigger = full ? required('#compare') : help
    renderComparison(full)
    overlay.hidden = false
    required('#acknowledge').focus()
  }
  const hideComparison = (): void => {
    overlay.hidden = true
    comparisonTrigger.focus()
  }
  help.addEventListener('click', () => { showComparison() })
  required('#compare').addEventListener('click', () => { showComparison(true) })
  close.addEventListener('click', hideComparison)
  required('#acknowledge').addEventListener('click', hideComparison)
  overlay.addEventListener('click', (event) => { if (event.target === overlay) hideComparison() })

  const submitSelection = (): void => {
    if (submitting) return
    submitting = true
    renderStep()
    if (selected === 'reused') {
      if (source !== undefined && origin === 'community') {
        ipcRenderer.send('dsh:data-home:selected', {
          mode: selected,
          sourceKind: 'community',
          source,
          ...(sources.community.selectionId === undefined
            ? {} : { sourceSelectionId: sources.community.selectionId }),
        })
      }
      return
    }
    const target = targetMode === 'default'
      ? { kind: 'default' as const }
      : customTarget === undefined ? undefined : { kind: 'custom' as const, selectionId: customTarget.selectionId }
    if (target === undefined) {
      submitting = false
      targetErrorKind = 'unreadable'
      renderStep()
      return
    }
    ipcRenderer.send('dsh:data-home:selected', selected === 'fresh'
      ? { mode: selected, target }
      : {
        mode: 'copied', sourceKind: origin, source, target,
        pluginMigration: migrationMode === 'offline' && portableBundle !== undefined
          ? { mode: 'offline', selectionId: portableBundle.selectionId } : { mode: 'online' },
        ...(origin !== 'community' || sources.community.selectionId === undefined
          ? {} : { sourceSelectionId: sources.community.selectionId }),
      })
  }

  continueButton.addEventListener('click', () => {
    if (sourceSelectionPending || submitting) return
    if (selected !== 'fresh' && displayedSource() === undefined) {
      void chooseSource(origin as ExistingSourceCategory)
      return
    }
    if (step === 'details') {
      if (origin === 'fresh') enterDestinationStep()
      else if (origin === 'official') enterPortableStep()
      else {
        step = 'operation'
        renderStep()
        operationChoices.find(choice => choice.dataset.operation === selected)?.focus()
      }
      return
    }
    if (step === 'operation' && selected === 'imported') {
      enterPortableStep()
      return
    }
    if (step === 'plugins') {
      enterDestinationStep()
      return
    }
    if (selected !== 'reused' && selectedTargetPath() === undefined) {
      targetErrorKind = 'unreadable'
      renderDestination()
      return
    }
    submitSelection()
  })
  backButton.addEventListener('click', () => {
    if (step !== 'details' && !submitting) leaveDestinationStep()
  })
  returnMainButton.addEventListener('click', () => {
    if (!submitting) ipcRenderer.send('dsh:data-home:cancelled')
  })
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || submitting) return
    if (!languageMenu.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeLanguageMenu(true)
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const focusedIndex = languageOptions.findIndex(option => option === document.activeElement)
        const direction = event.key === 'ArrowDown' ? 1 : -1
        const nextIndex = (focusedIndex + direction + languageOptions.length) % languageOptions.length
        languageOptions[nextIndex]?.focus()
      }
      return
    }
    if (event.key === 'Escape' && !overlay.hidden) hideComparison()
    else if (event.key === 'Escape') ipcRenderer.send('dsh:data-home:cancelled')
    else if (event.key === 'Enter' && overlay.hidden
      && !(event.target instanceof HTMLButtonElement)) continueButton.click()
  })
  renderCopy()
  select(selected)
}, { once: true })
