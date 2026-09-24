/**
 * Browser-only interaction harness for reviewing the first-run chooser from source.
 * Electron marks the document from its preload, so this module never handles a real selection.
 */
(() => {
  if (document.documentElement.dataset.desktopChooser === 'true'
    || new URLSearchParams(window.location.search).has('defaultTarget')) return

  const required = (selector) => {
    const element = document.querySelector(selector)
    if (element === null) throw new Error(`preview: missing ${selector}`)
    return element
  }
  const text = (selector, value) => {
    required(selector).textContent = value
  }
  const textAll = (selector, value) => {
    for (const element of document.querySelectorAll(selector)) element.textContent = value
  }
  const dictionaries = {
    zh: {
      officialRetained: '保留对话、设置、凭据、Agent 预设和 Skills 等受支持数据。',
      officialPlugins: '不复制插件本体；进入后可选择联网重新安装，本地源码等来源需手动提供。',
      retainedPluginsBoth: '两种方式均全部保留。',
      language: '语言', current: '中文', officialChoice: '导入官方 DeepSeek Harness 配置',
      officialChoiceSummary: '将兼容数据复制到独立环境，不与官方目录共享。',
      communityChoice: '使用社区桌面版配置',
      communityChoiceSummary: '直接使用或复制 Open DeepSeek Harness Desktop 的已有配置。',
      freshChoice: '全新开始', freshChoiceSummary: '不导入任何现有数据。',
      officialCard: '官方配置', communityCard: '社区配置', detected: '已检测到', missing: '未检测到',
      hint: '可手动选择其他目录。', chooseOfficial: '选择官方目录', chooseCommunity: '选择社区目录',
      officialTitle: '导入官方 DeepSeek Harness 配置',
      communityTitle: '使用社区桌面版配置', freshTitle: '全新开始',
      officialLocation: '使用官方 .dsh 或你选择的 DSH 数据目录，将兼容数据复制到独立目录。',
      communityLocation: '使用社区桌面版已有的数据目录。',
      retentionLabel: '保留范围',
      retainedData: '历史对话、设置、凭据、Agent 预设、Skill、插件及插件配置全部保留。',
      sourcePlugins: '全部保留。',
      sourceBuilds: '不会因选择来源而增加构建权限。',
      freshLocation: '创建桌面版管理的空配置目录。',
      freshSharing: '不读取或修改任何已有配置。',
      freshPlugins: '从空 Profile 开始，仅核对桌面预置插件。',
      freshBuilds: '只加入经过审核且实际需要的预置构建许可。',
      operationTitle: '选择使用方式', officialImportTitle: '导入到独立环境',
      officialOperationSummary: '直接使用保留官方目录；导入会转换可兼容数据，并在新目录中创建独立环境。',
      operationSummary: '直接使用保留现有环境；复制会在新目录中创建独立环境。',
      portableTitle: '选择插件迁移方式', portableSummary: '联网恢复或使用在导出电脑上联网准备的离线包。',
      portableOnline: '联网迁移', portableOnlineDetail: '导入后按清单联网安装插件。',
      portableOffline: '离线迁移', portableOfflineDetail: '选择与目标系统匹配的插件迁移包。',
      portableChoose: '选择离线包', portableMissing: '请先选择离线包。',
      portableCurrentHost: '本机系统（目标值）',
      importTitle: '复制到独立环境', importSummary: '复制受支持数据，之后与来源分离。',
      reuseTitle: '直接使用此配置', reuseSummary: '直接使用所选配置目录，不创建副本。',
      officialCopySummary: '转换并导入可兼容数据到新目录，原官方配置保持不变。',
      communityCopySummary: '复制此社区桌面配置到新目录，原配置保持不变。',
      officialReuseSummary: '社区桌面版与官方 DeepSeek Harness 共用此目录，任一端修改都会生效。',
      communityReuseSummary: '直接使用所选的社区桌面版配置目录，不复制、迁移或转换数据。',
      importSharing: '复制完成后不共享；来源保持不变。',
      importPlugins: '复制插件恢复清单，进入后选择重新安装。',
      importBuilds: '仅合并经过验证的精确许可；明确拒绝仍保持拒绝。',
      reuseSharing: '共享设置、凭据、会话、Agent 预设、Skill、Profile 和插件。',
      reusePlugins: '保留当前版本，不重复安装同一插件。',
      reuseBuilds: '直接沿用所选配置中的 allowBuilds，不合并或新增权限。',
      risk: '社区桌面版与官方 DeepSeek Harness 将直接读写同一目录。',
      destinationTitle: '选择配置目录',
      destinationSummary: '使用桌面版默认目录，或选择一个空文件夹。',
      defaultTarget: '默认设置', defaultTargetSummary: '使用桌面版管理的独立目录。',
      customTarget: '自定义配置目录', customTargetSummary: '选择一个空文件夹作为独立配置目录。',
      chooseEmpty: '选择空文件夹', continue: '继续', back: '上一步', start: '开始使用',
      compare: '查看完整对比', compareTitle: '这三个选项有什么区别？', acknowledge: '知道了',
      locationLabel: '数据位置', sharingLabel: '共享范围', pluginsLabel: '已有插件',
      buildsLabel: '构建权限', suitableLabel: '适合谁',
      windowTitle: '选择数据目录', helpLabel: '查看三个选项的区别', closeLabel: '关闭',
      modeGroupLabel: '配置来源', targetGroupLabel: '数据目录位置', sourceRequired: '需要先选择已有配置目录。',
      targetRequired: '请先选择一个空文件夹。', changeEmpty: '更换文件夹',
      officialSuitable: '将官方 DeepSeek Harness 配置用于 Open DeepSeek Harness Desktop。',
      communitySuitable: '继续现有社区桌面环境，或创建独立副本。',
      freshSuitable: '希望完全从零配置的用户。',
      comparisonNote: '官方配置只会导入到独立目录；社区配置通过本应用身份校验后可以直接使用或复制。',
      complete: '预览完成', completeSummary: '正式客户端会从这里开始准备配置。',
    },
    en: {
      officialRetained: 'Retain conversations, settings, credentials, Agent presets, Skills, and other supported data.',
      officialPlugins: 'Plugin files are not copied. Choose plugins to reinstall online afterward; local source plugins may require files supplied manually.',
      retainedPluginsBoth: 'All are retained with either option.',
      language: 'Language', current: 'English', officialChoice: 'Import official DeepSeek Harness configuration',
      officialChoiceSummary: 'Copy compatible data into an independent environment without sharing the official directory.',
      communityChoice: 'Use community desktop configuration',
      communityChoiceSummary: 'Use or copy an existing Open DeepSeek Harness Desktop configuration.',
      freshChoice: 'Start fresh', freshChoiceSummary: 'Do not import existing data.',
      officialCard: 'Official', communityCard: 'Community', detected: 'Detected', missing: 'Not detected',
      hint: 'Choose another directory if needed.', chooseOfficial: 'Choose official folder',
      chooseCommunity: 'Choose community folder', officialTitle: 'Import official DeepSeek Harness configuration',
      communityTitle: 'Use community desktop configuration', freshTitle: 'Start fresh',
      officialLocation: 'Use the official .dsh folder or another DSH data directory and copy compatible data into an independent directory.',
      communityLocation: 'Use an existing community desktop data directory.',
      retentionLabel: 'Data retained',
      retainedData: 'Conversation history, settings, credentials, Agent presets, Skills, plugins, and plugin configuration are all retained.',
      sourcePlugins: 'All retained.',
      sourceBuilds: 'Choosing a source does not grant extra build permissions.',
      freshLocation: 'Create an empty desktop-managed configuration directory.',
      freshSharing: 'Do not read or change existing configuration.',
      freshPlugins: 'Start with an empty Profile and reconcile desktop presets only.',
      freshBuilds: 'Add only reviewed approvals required by desktop presets.',
      operationTitle: 'Choose how to use this configuration', officialImportTitle: 'Import into an independent environment',
      officialOperationSummary: 'Direct use keeps the official directory; importing converts compatible data and creates an independent environment in a new directory.',
      operationSummary: 'Direct use keeps the environment; copying creates an independent environment in a new directory.',
      portableTitle: 'Choose plugin migration', portableSummary: 'Restore online or use a bundle prepared online on the export computer.',
      portableOnline: 'Online migration', portableOnlineDetail: 'Install plugins from the restore list after import.',
      portableOffline: 'Offline migration', portableOfflineDetail: 'Choose a plugin bundle matching the target OS.',
      portableChoose: 'Choose offline bundle', portableMissing: 'Choose an offline bundle first.',
      portableCurrentHost: 'This computer (target value)',
      importTitle: 'Copy to an independent environment',
      importSummary: 'Copy supported data once; later changes remain separate.',
      reuseTitle: 'Use this configuration directly',
      reuseSummary: 'Use the selected configuration directory in place without creating a copy.',
      officialCopySummary: 'Convert and import compatible data into a new directory while leaving the official configuration unchanged.',
      communityCopySummary: 'Copy this community desktop configuration into a new directory while leaving the source unchanged.',
      officialReuseSummary: 'Open DeepSeek Harness Desktop and official DeepSeek Harness use this same directory; changes from either application take effect.',
      communityReuseSummary: 'Use the selected community desktop configuration directory directly without copying, migrating, or converting data.',
      importSharing: 'Nothing stays shared after copying; the source remains unchanged.',
      importPlugins: 'Copy a restore list, then choose plugins to reinstall.',
      importBuilds: 'Merge only validated exact approvals; explicit denials remain denied.',
      reuseSharing: 'Share settings, credentials, sessions, presets, Skills, Profiles, and plugins.',
      reusePlugins: 'Keep current versions without installing the same plugin twice.',
      reuseBuilds: 'Use the selected configuration\'s allowBuilds as-is without merging or granting permissions.',
      risk: 'Desktop and the selected directory affect each other, including credentials, sessions, and plugins.',
      destinationTitle: 'Choose configuration directory',
      destinationSummary: 'Use the desktop default or choose an empty folder.',
      defaultTarget: 'Default location', defaultTargetSummary: 'Use the independent directory managed by Desktop.',
      customTarget: 'Custom configuration directory',
      customTargetSummary: 'Choose an empty folder for the independent configuration.',
      chooseEmpty: 'Choose empty folder', continue: 'Continue', back: 'Back', start: 'Start',
      compare: 'View full comparison', compareTitle: 'How do these options differ?', acknowledge: 'Got it',
      locationLabel: 'Data location', sharingLabel: 'Sharing', pluginsLabel: 'Existing plugins',
      buildsLabel: 'Build approvals', suitableLabel: 'Best for',
      windowTitle: 'Choose data directory', helpLabel: 'Compare the three options', closeLabel: 'Close',
      modeGroupLabel: 'Configuration source', targetGroupLabel: 'Data directory location',
      sourceRequired: 'Choose an existing configuration directory first.',
      targetRequired: 'Choose an empty folder first.', changeEmpty: 'Change folder',
      officialSuitable: 'Use an official DeepSeek Harness configuration with Open DeepSeek Harness Desktop.',
      communitySuitable: 'Continue an existing community desktop environment or create an independent copy.',
      freshSuitable: 'Start with a completely new configuration.',
      comparisonNote: 'Official data is imported only into an independent directory. Community data can be used or copied after this app verifies its identity.',
      complete: 'Preview complete', completeSummary: 'The desktop client starts configuration preparation here.',
    },
  }

  const state = {
    locale: 'zh',
    origin: 'official',
    operation: 'imported',
    migration: 'online',
    portableChosen: false,
    step: 'details',
    completed: false,
    target: 'default',
    customTarget: null,
    sources: { official: null, community: null },
  }
  const sourcePaths = {
    official: '<用户目录>/.dsh',
    community: '<应用数据目录>/open-deepseek-harness-desktop/dsh-home',
  }

  const copy = () => dictionaries[state.locale]
  const sourceElements = {
    official: {
      status: required('#official-source-status'), path: required('#official-source-path'),
      summary: required('#official-source-summary'), button: required('#choose-official-source'),
      panel: required('#official-source'),
    },
    community: {
      status: required('#community-source-status'), path: required('#community-source-path'),
      summary: required('#community-source-summary'), button: required('#choose-community-source'),
      panel: required('#community-source'),
    },
  }

  const renderSources = () => {
    const value = copy()
    for (const category of ['official', 'community']) {
      const found = state.sources[category] !== null
      const view = sourceElements[category]
      view.panel.dataset.status = found ? 'valid' : 'missing'
      view.status.textContent = `${category === 'official' ? value.officialCard : value.communityCard} · ${found ? value.detected : value.missing}`
      view.path.textContent = state.sources[category] ?? ''
      view.path.hidden = !found
      view.summary.textContent = value.hint
      view.summary.hidden = found
      view.button.textContent = category === 'official' ? value.chooseOfficial : value.chooseCommunity
    }
  }

  const details = () => {
    const value = copy()
    if (state.origin === 'fresh') {
      return {
        title: value.freshTitle, location: value.freshLocation, sharing: value.freshSharing,
        plugins: value.freshPlugins, builds: value.freshBuilds,
      }
    }
    return {
      title: state.origin === 'official' ? value.officialTitle : value.communityTitle,
      location: state.origin === 'official' ? value.officialLocation : value.communityLocation,
      sharing: state.origin === 'official' ? value.importSummary : value.retainedData,
      plugins: state.origin === 'official' ? value.importPlugins : value.sourcePlugins, builds: value.sourceBuilds,
    }
  }

  const render = () => {
    const value = copy()
    const detail = details()
    document.documentElement.lang = state.locale === 'zh' ? 'zh-CN' : 'en'
    document.title = value.windowTitle
    text('#language-current', value.current)
    text('[data-copy="languageLabel"]', value.language)
    required('#language-trigger').ariaLabel = `${value.language}: ${value.current}`
    required('#language-menu').ariaLabel = value.language
    required('#help').ariaLabel = value.helpLabel
    required('#close-comparison').ariaLabel = value.closeLabel
    required('#choices').ariaLabel = value.modeGroupLabel
    required('#target-choices').ariaLabel = value.targetGroupLabel
    const choiceCopy = [
      ['official', value.officialChoice, value.officialChoiceSummary],
      ['community', value.communityChoice, value.communityChoiceSummary],
      ['fresh', value.freshChoice, value.freshChoiceSummary],
    ]
    for (const [category, title, summary] of choiceCopy) {
      const choice = required(`[data-source="${category}"]`)
      choice.ariaChecked = String(state.origin === category)
      choice.querySelector('.choice-title').textContent = title
      choice.querySelector('.choice-description').textContent = summary
      const requirement = choice.querySelector('.choice-requirement')
      if (requirement !== null) {
        requirement.textContent = value.sourceRequired
        requirement.hidden = category === 'fresh' || state.sources[category] !== null
      }
    }
    required('#detail').dataset.source = state.origin
    text('#detail-title', state.completed ? value.complete : detail.title)
    text('#location-value', state.completed ? value.completeSummary : detail.location)
    text('#sharing-value', state.completed ? '' : detail.sharing)
    text('#plugins-value', state.completed ? '' : detail.plugins)
    text('#builds-value', state.completed ? '' : detail.builds)
    required('#detail-stage').dataset.step = state.step
    required('#facts').inert = state.step !== 'details'
    required('#operation-panel').inert = state.step !== 'operation'
    required('#portable-panel').inert = state.step !== 'plugins'
    required('#destination-panel').inert = state.step !== 'destination'
    required('#operation-panel').ariaHidden = String(state.step !== 'operation')
    required('#portable-panel').ariaHidden = String(state.step !== 'plugins')
    required('#destination-panel').ariaHidden = String(state.step !== 'destination')
    text('#portable-title', value.portableTitle)
    text('#portable-summary', value.portableSummary)
    text('#portable-current-host', `${value.portableCurrentHost}: ${state.locale === 'zh' ? '<系统>/<架构> · <系统版本>' : '<OS>/<architecture> · <OS release>'}`)
    text('#portable-online-title', value.portableOnline)
    text('#portable-online-detail', value.portableOnlineDetail)
    text('#portable-offline-title', value.portableOffline)
    text('#portable-offline-detail', value.portableOfflineDetail)
    text('#choose-portable', value.portableChoose)
    for (const migration of document.querySelectorAll('[data-migration]')) {
      migration.ariaChecked = String(migration.dataset.migration === state.migration)
    }
    required('#portable-selection').hidden = state.migration !== 'offline'
    text('#portable-target', state.portableChosen ? (state.locale === 'zh' ? '预览：已选择离线包' : 'Preview: bundle selected') : '')
    text('#portable-error', state.migration === 'offline' && !state.portableChosen ? value.portableMissing : '')
    required('#portable-error').hidden = state.migration !== 'offline' || state.portableChosen
    textAll('[data-copy="operationTitle"]', value.operationTitle)
    text('.operation-panel .destination-summary', state.origin === 'official'
      ? value.officialOperationSummary : value.operationSummary)
    const imported = required('[data-operation="imported"]')
    const reused = required('[data-operation="reused"]')
    reused.hidden = state.origin === 'official'
    imported.ariaChecked = String(state.operation === 'imported')
    reused.ariaChecked = String(state.operation === 'reused')
    imported.querySelector('strong').textContent = state.origin === 'official'
      ? value.officialImportTitle : value.importTitle
    imported.querySelector('.target-copy span').textContent = state.origin === 'community'
      ? value.communityCopySummary : value.officialCopySummary
    reused.querySelector('strong').textContent = value.reuseTitle
    reused.querySelector('.target-copy span').textContent = state.origin === 'community'
      ? value.communityReuseSummary : value.officialReuseSummary
    const reusing = state.operation === 'reused'
    text('#operation-sharing', reusing ? value.reuseSharing : value.importSharing)
    text('#operation-plugins', reusing ? value.reusePlugins : value.importPlugins)
    text('#operation-builds', reusing ? value.reuseBuilds : value.importBuilds)
    text('#risk', value.risk)
    required('#risk').hidden = state.step !== 'operation' || !reusing || state.origin !== 'official'
    textAll('[data-copy="destinationTitle"]', value.destinationTitle)
    text('#destination-summary', value.destinationSummary)
    text('[data-copy="defaultTargetTitle"]', value.defaultTarget)
    text('[data-copy="defaultTargetSummary"]', value.defaultTargetSummary)
    text('[data-copy="customTargetTitle"]', value.customTarget)
    text('[data-copy="customTargetSummary"]', value.customTargetSummary)
    text('#choose-target', state.customTarget === null ? value.chooseEmpty : value.changeEmpty)
    text('#default-target-path', state.locale === 'zh'
      ? '<应用数据目录>/open-deepseek-harness-desktop/dsh-home'
      : '<application data>/open-deepseek-harness-desktop/dsh-home')
    for (const target of document.querySelectorAll('[data-target]')) {
      target.ariaChecked = String(target.dataset.target === state.target)
    }
    const customTargetPath = required('#custom-target-path')
    if (state.customTarget !== null) {
      state.customTarget = state.locale === 'zh' ? '<所选空目录>' : '<selected empty folder>'
      customTargetPath.textContent = state.customTarget
    }
    customTargetPath.hidden = state.customTarget === null
    const targetError = required('#custom-target-error')
    targetError.textContent = state.target === 'custom' && state.customTarget === null ? value.targetRequired : ''
    targetError.hidden = targetError.textContent.length === 0
    text('#compare', value.compare)
    text('#back', value.back)
    text('#continue', state.completed ? value.complete : state.step === 'destination' || reusing ? value.start : value.continue)
    required('#continue').disabled = state.completed
      || (state.step === 'destination' && state.target === 'custom' && state.customTarget === null)
    required('#back').hidden = state.step === 'details' || state.completed
    renderSources()
  }

  const selectSource = (category) => {
    state.origin = category
    state.step = 'details'
    state.completed = false
    render()
  }
  for (const choice of document.querySelectorAll('.choice')) {
    choice.addEventListener('click', () => { selectSource(choice.dataset.source) })
  }
  for (const category of ['official', 'community']) {
    sourceElements[category].button.addEventListener('click', () => {
      state.sources[category] = sourcePaths[category]
      selectSource(category)
    })
  }
  for (const operation of document.querySelectorAll('[data-operation]')) {
    operation.addEventListener('click', () => {
      state.operation = operation.dataset.operation
      render()
    })
  }
  for (const migration of document.querySelectorAll('[data-migration]')) {
    migration.addEventListener('click', () => {
      state.migration = migration.dataset.migration
      render()
    })
  }
  required('#choose-portable').addEventListener('click', () => {
    state.portableChosen = true
    render()
  })
  for (const target of document.querySelectorAll('[data-target]')) {
    target.addEventListener('click', () => {
      state.target = target.dataset.target
      render()
    })
    target.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      target.click()
    })
  }
  required('#choose-target').addEventListener('click', (event) => {
    event.stopPropagation()
    state.target = 'custom'
    state.customTarget = state.locale === 'zh' ? '<所选空目录>' : '<selected empty folder>'
    text('#custom-target-path', state.customTarget)
    required('#custom-target-path').hidden = false
    render()
  })
  required('#continue').addEventListener('click', () => {
    if (state.completed) return
    if (state.step === 'details') {
      if (state.origin !== 'fresh' && state.sources[state.origin] === null) {
        state.sources[state.origin] = sourcePaths[state.origin]
        renderSources()
      }
      state.step = state.origin === 'community' ? 'operation' : state.origin === 'official' ? 'plugins' : 'destination'
    } else if (state.step === 'operation' && state.operation === 'imported') state.step = 'plugins'
    else if (state.step === 'plugins') state.step = 'destination'
    else if (state.target !== 'custom' || state.customTarget !== null) state.completed = true
    render()
  })
  required('#back').addEventListener('click', () => {
    state.step = state.step === 'destination' && state.origin !== 'fresh' ? 'plugins'
      : state.step === 'plugins' && state.origin === 'community' ? 'operation' : 'details'
    render()
  })

  const overlay = required('#overlay')
  const renderComparisonTable = (title, note, labels, columns, toneKind) => {
    text('#comparison-title', title)
    text('.comparison-note', note)
    const headingRow = document.createElement('tr')
    headingRow.append(document.createElement('th'))
    for (const column of columns) {
      const heading = document.createElement('th')
      heading.textContent = column.title
      heading.dataset.mode = column.tone
      heading.dataset[toneKind] = column.tone
      headingRow.append(heading)
    }
    required('#comparison-head').replaceChildren(headingRow)
    required('#comparison-body').replaceChildren(...labels.map((label, rowIndex) => {
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
  let comparisonTrigger = required('#help')
  const showComparison = (full = false) => {
    comparisonTrigger = required(full ? '#compare' : '#help')
    const value = copy()
    text('[data-copy="acknowledge"]', value.acknowledge)
    if (full || state.step === 'details') {
      renderComparisonTable(value.compareTitle, value.comparisonNote,
        [value.locationLabel, value.retentionLabel, value.pluginsLabel, value.suitableLabel], [
          { title: value.officialChoice, tone: 'official', values: [value.officialLocation,
            value.officialRetained, value.officialPlugins, value.officialSuitable] },
          { title: value.communityChoice, tone: 'community', values: [value.communityLocation,
            `${value.importTitle}: ${value.officialRetained}\n\n${value.reuseTitle}: ${value.retainedData}`,
            `${value.importTitle}: ${value.officialPlugins}\n\n${value.reuseTitle}: ${value.reusePlugins}`,
            value.communitySuitable] },
          { title: value.freshChoice, tone: 'fresh', values: [value.freshLocation, value.freshSharing, value.freshPlugins, value.freshSuitable] },
        ], 'source')
    } else if (state.step === 'operation') {
      const copiedSummary = state.origin === 'community' ? value.communityCopySummary : value.officialCopySummary
      const reusedSummary = state.origin === 'community' ? value.communityReuseSummary : value.officialReuseSummary
      renderComparisonTable(value.operationTitle, state.origin === 'official'
        ? value.officialOperationSummary : value.operationSummary,
        [value.locationLabel, value.sharingLabel, value.pluginsLabel, value.buildsLabel, value.suitableLabel], [
          { title: state.origin === 'official' ? value.officialImportTitle : value.importTitle, tone: 'copy', values: [value.importSummary, value.importSharing, value.importPlugins, value.importBuilds, copiedSummary] },
          { title: value.reuseTitle, tone: 'reuse', values: [value.reuseSummary, value.reuseSharing, value.reusePlugins, value.reuseBuilds, reusedSummary] },
        ], 'option')
    } else if (state.step === 'plugins') {
      renderComparisonTable(value.portableTitle, value.portableSummary,
        [value.pluginsLabel], [
          { title: value.portableOnline, tone: 'default', values: [value.portableOnlineDetail] },
          { title: value.portableOffline, tone: 'custom', values: [value.portableOfflineDetail] },
        ], 'option')
    } else {
      renderComparisonTable(value.destinationTitle, value.destinationSummary,
        [value.locationLabel, value.suitableLabel], [
          { title: value.defaultTarget, tone: 'default', values: [required('#default-target-path').textContent, value.defaultTargetSummary] },
          { title: value.customTarget, tone: 'custom', values: [state.customTarget ?? value.chooseEmpty, value.customTargetSummary] },
        ], 'option')
    }
    overlay.hidden = false
    required('#acknowledge').focus()
  }
  required('#help').addEventListener('click', () => showComparison())
  required('#compare').addEventListener('click', () => showComparison(true))
  const hideComparison = () => {
    overlay.hidden = true
    comparisonTrigger.focus()
  }
  required('#close-comparison').addEventListener('click', hideComparison)
  required('#acknowledge').addEventListener('click', hideComparison)
  overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.hidden = true })

  const languageMenu = required('#language-menu')
  for (const locale of ['zh', 'en']) {
    const option = document.createElement('button')
    option.className = 'language-option'
    option.type = 'button'
    option.role = 'option'
    option.dataset.language = locale
    option.textContent = locale === 'zh' ? '中文' : 'English'
    option.addEventListener('click', () => {
      state.locale = locale
      languageMenu.hidden = true
      required('#language-trigger').ariaExpanded = 'false'
      render()
    })
    languageMenu.append(option)
  }
  required('#language-trigger').addEventListener('click', () => {
    languageMenu.hidden = !languageMenu.hidden
    required('#language-trigger').ariaExpanded = String(!languageMenu.hidden)
  })
  document.addEventListener('click', (event) => {
    const picker = required('#language-picker')
    if (!languageMenu.hidden && event.target instanceof Node && !picker.contains(event.target)) {
      languageMenu.hidden = true
      required('#language-trigger').ariaExpanded = 'false'
    }
  })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!overlay.hidden) hideComparison()
      else languageMenu.hidden = true
    } else if (event.key === 'Enter' && overlay.hidden && !(event.target instanceof HTMLButtonElement)) {
      required('#continue').click()
    }
  })
  render()
})()
