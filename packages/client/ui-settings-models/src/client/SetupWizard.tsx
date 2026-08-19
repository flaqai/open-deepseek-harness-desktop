/** First-run checklist that routes into the existing Models and IM settings pages. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconCloseOutline16,
  IconDataOutline16, IconPersonalizationOutline16, Menu, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { onboardingReadiness } from './store.ts'
import type { WelcomeNoticeState, WelcomeNoticeStore } from './welcome-store.ts'
import type { en } from './locales.ts'
import css from './SetupWizard.module.css'

type TaskId = 'models' | 'im'
type TaskResult = 'complete' | 'skipped'

interface SetupLocaleState {
  active: string
  locales: readonly { id: string; label: string }[]
  revision: number
}

/** Dependencies shared with the Models settings page and durable welcome acknowledgement. */
export interface SetupWizardInjected {
  hooks: {
    models: SnapshotStore<ModelsSettingsState>
    welcome: SnapshotStore<WelcomeNoticeState>
    locale: ObservableSnapshot<SetupLocaleState>
  }
  modelsController: ModelsSettingsStore
  welcomeController: WelcomeNoticeStore
  setLocale: (id: string) => void
  t: (key: keyof typeof en) => string
}

/** Slot owner state plus wizard dependencies. */
export type SetupWizardProps = PropsRuntime<'settings.onboarding'> & InjectFace<SetupWizardInjected>

/** Render the first-run task overview, final welcome, and settings-page launch actions. */
export function SetupWizard(props: SetupWizardProps): ReactNode {
  const {
    complete, openSection, modelsController, welcomeController,
    useModels, useWelcome, useLocale, setLocale, t,
  } = props
  const models = useModels(snapshot => snapshot)
  const welcome = useWelcome(snapshot => snapshot)
  const locale = useLocale(snapshot => snapshot)
  const readiness = onboardingReadiness(models)
  const [results, setResults] = useState<Partial<Record<TaskId, TaskResult>>>({})
  const titleRef = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    if (models.status === 'idle') void modelsController.load()
  }, [models.status, modelsController])

  useEffect(() => {
    if (welcome.status === 'idle') void welcomeController.load()
  }, [welcome.status, welcomeController])

  useEffect(() => {
    if (welcome.acknowledged) complete()
  }, [complete, welcome.acknowledged])

  useEffect(() => {
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    const previous = appRoot.inert
    appRoot.inert = true
    return () => { appRoot.inert = previous }
  }, [])

  useEffect(() => { titleRef.current?.focus() }, [])

  const modelReady = readiness.kind === 'provider-ready'
  const modelResult = modelReady ? 'complete' : results.models
  const imResult = results.im
  const finishedCount = Number(modelResult !== undefined) + Number(imResult !== undefined)
  const allFinished = finishedCount === 2
  const allComplete = modelResult === 'complete' && imResult === 'complete'
  const activeStep = modelResult === undefined ? 1 : imResult === undefined ? 2 : 3

  const mark = useCallback((id: TaskId, result: TaskResult) => {
    setResults(previous => ({ ...previous, [id]: result }))
  }, [])

  const start = async (): Promise<void> => {
    if (await welcomeController.acknowledge()) complete()
  }

  const rail = [
    t('setup.step.models'), t('setup.step.messages'), t('setup.step.ready'),
  ]

  if (welcome.status === 'idle' || welcome.status === 'loading' || welcome.acknowledged) return null

  return (
    <Modal open title={t('setup.title')} onClose={() => { mark('models', 'skipped'); mark('im', 'skipped') }} headless className={css.dialog as string}>
      <div className={css.layout}>
        <aside className={css.rail}>
          <h2 className={css.railTitle}>{t('setup.start')}</h2>
          {rail.map((label, index) => {
            const step = index + 1
            const done = step < activeStep
            return (
              <div key={label} className={css.step} data-active={step === activeStep ? 'true' : undefined}>
                <span className={css.stepNumber} data-complete={done ? 'true' : undefined}>
                  {done ? <IconCheckOutline16 size={14} /> : step}
                </span>
                <span>{label}</span>
              </div>
            )
          })}
        </aside>

        <main className={css.main}>
          <div className={css.topActions}>
            <LanguageSelect
              active={locale.active}
              options={locale.locales}
              label={t('setup.language')}
              onSelect={setLocale}
            />
            <button type="button" className={css.close} aria-label={t('setup.close')} onClick={() => {
              mark('models', 'skipped')
              mark('im', 'skipped')
            }}>
              <IconCloseOutline16 size={16} />
            </button>
          </div>

          {allFinished ? (
            <div className={css.success}>
              <span className={css.successIcon}><IconCheckOutline16 size={28} /></span>
              <h1 ref={titleRef} tabIndex={-1}>{t(allComplete ? 'setup.success' : 'setup.ready')}</h1>
              <p>{t(allComplete ? 'setup.successDescription' : 'setup.readyDescription')}</p>
              {welcome.error === null ? null : <p className={css.error} role="alert">{t('setup.saveError')}</p>}
              <button type="button" className={css.primary} disabled={welcome.status === 'saving'} onClick={() => { void start() }}>
                {t(welcome.status === 'saving' ? 'setup.starting' : 'setup.experience')}
              </button>
            </div>
          ) : (
            <>
              <div className={css.heading}>
                <h1 ref={titleRef} tabIndex={-1}>{t('setup.title')}</h1>
                <p>{t('setup.description')}</p>
              </div>
              <div className={css.tasks}>
                <TaskRow
                  icon={<IconDataOutline16 size={20} />}
                  title={t('setup.models.title')}
                  description={t('setup.models.description')}
                  status={modelResult}
                  statusLabel={modelResult === 'complete'
                    ? t('setup.completed')
                    : modelResult === 'skipped' ? t('setup.skipped') : undefined}
                  configureLabel={modelResult === undefined ? t('setup.configure') : t('setup.reconfigure')}
                  skipLabel={t('setup.skip')}
                  onConfigure={() => {
                    openSection({
                      sectionId: 'models', step: 1,
                      complete: () => { mark('models', 'complete') },
                    })
                  }}
                  onSkip={() => { mark('models', 'skipped') }}
                />
                <TaskRow
                  icon={<IconPersonalizationOutline16 size={20} />}
                  title={t('setup.im.title')}
                  description={t('setup.im.description')}
                  status={imResult}
                  statusLabel={imResult === 'complete'
                    ? t('setup.completed')
                    : imResult === 'skipped' ? t('setup.skipped') : t('setup.optional')}
                  configureLabel={imResult === undefined ? t('setup.configure') : t('setup.reconfigure')}
                  skipLabel={t('setup.skip')}
                  onConfigure={() => {
                    openSection({
                      sectionId: 'plugins', subsectionId: 'im', step: 2,
                      complete: () => { mark('im', 'complete') },
                    })
                  }}
                  onSkip={() => { mark('im', 'skipped') }}
                />
              </div>
              <footer className={css.footer}>
                <button type="button" className={css.skipAll} onClick={() => {
                  mark('models', 'skipped')
                  mark('im', 'skipped')
                }}>
                  {t('setup.skipAll')}
                </button>
                <span>{t('setup.progress').replace('{count}', String(finishedCount))}</span>
              </footer>
            </>
          )}
        </main>
      </div>
    </Modal>
  )
}

function LanguageSelect(props: {
  active: string
  options: readonly { id: string; label: string }[]
  label: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const activeLabel = props.options.find(option => option.id === props.active)?.label ?? props.active
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={props.options.map(option => ({ id: option.id, label: option.label }))}
      selectedId={props.active}
      onSelect={(id) => {
        props.onSelect(id)
        setOpen(false)
      }}
      align="end"
      portal
      anchor={(
        <button
          type="button"
          className={css.language}
          aria-label={`${props.label}: ${activeLabel}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}
        >
          {activeLabel}
          <IconChevronDownOutline14 className={css.languageChevron} />
        </button>
      )}
    />
  )
}

function TaskRow(props: {
  icon: ReactNode
  title: string
  description: string
  status: TaskResult | undefined
  statusLabel: string | undefined
  configureLabel: string
  skipLabel: string
  onConfigure: () => void
  onSkip: () => void
}) {
  const completed = props.status === 'complete'
  return (
    <section className={css.task} data-complete={completed ? 'true' : undefined}>
      <span className={css.taskStatus}>
        {completed ? <IconCheckOutline16 size={16} /> : null}
      </span>
      <span className={css.taskIcon}>{props.icon}</span>
      <span className={css.taskCopy}>
        <strong>{props.title}</strong>
        <span>{props.description}</span>
      </span>
      {props.statusLabel === undefined ? null : <span className={css.taskLabel}>{props.statusLabel}</span>}
      <span className={css.taskActions}>
        {props.status === undefined
          ? <button type="button" className={css.taskSkip} onClick={props.onSkip}>{props.skipLabel}</button>
          : null}
        <button type="button" className={css.taskConfigure} onClick={props.onConfigure}>{props.configureLabel}</button>
      </span>
    </section>
  )
}
