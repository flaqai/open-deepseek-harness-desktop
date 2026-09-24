/** Declarative Agent capability sets, activation and session binding. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { bindScopeParent, createScope, scopeOf, type Scope, type ScopeKey, type ScopeParentBinding } from '@deepseek-ai/dsh-scope'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { dump } from 'js-yaml'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type SettingsForms from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-tools'
import type { AgentPresetDocument, AgentPresetRoster } from './types.ts'
import { entryListProblem, type PresetDefinition } from './definition.ts'
import type { AgentPreset, Config } from './preset.ts'
import { agentPresetProjectionDefinition, externalToolsResolvedProjectionDefinition } from './session.ts'
import { acceptsExternalTools, externalToolEnabled, type ExternalToolId, type ExternalToolsState } from './external-tools.ts'
import { auditRows, mountPreset, standingMountFor, serviceForAgent, type PresetMount } from './mount.ts'
import { definitionComposition, mountedCompositionRows, type AgentPresetComposition } from './composition-inventory.ts'

export { agentPresetProjectionDefinition, externalToolsResolvedProjectionDefinition } from './session.ts'
export { acceptsExternalTools } from './external-tools.ts'
export type { ExternalToolId, ExternalToolSettings, ExternalToolsState } from './external-tools.ts'
export { entryListProblem, type PresetDefinition } from './definition.ts'
export { auditRows, livePresetMounts, leakedServices, serviceForAgent, standingMountFor, type PresetMount, type RowAudit } from './mount.ts'
export type { AgentPreset, Config } from './preset.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentPresets: AgentPresetRegistry
  }
}

interface Generation {
  scope: Scope
  key: ScopeKey
  mount: PresetMount
  users: number
  retired: boolean
}
interface Definition {
  config: PresetDefinition
  context: Context
  ready: Promise<void>
  generation?: Generation
  /** Mount failure; unset while a tree is mounted, whose rows {@link AgentPresetRegistry.diagnostic} re-audits on read. */
  broken?: string
}
interface Binding {
  parent: ScopeParentBinding
  generation: Generation
}

/** Host-owned factory that projects a connected coding product into one Agent scope. */
export type ExternalToolProjector = (agent: Agent, tool: ExternalToolId) => () => Promise<void> | void

/** Registry of YAML-declared presets and the revisions live Agents retain. */
export class AgentPresetRegistry extends TypertRemoteService {
  static inject = ['loader', 'sessionProjections']
  static Config = z.object({
    default: z.string().required(),
    selectedDefault: z.string().volatile(),
    modeSelectionEnabled: z.boolean().default(true).volatile(),
    externalTools: z.object({ codex: z.boolean(), claudeCode: z.boolean() }).volatile(),
  })
  private readonly owner: Context
  private readonly definitions = new Map<string, Definition>()
  private readonly generations = new Map<ScopeKey, Generation>()
  private readonly bindings = new WeakMap<ScopeKey, Binding>()
  private readonly switches = new Map<string, Promise<unknown>>()
  private readonly externalToolMounts = new WeakMap<Agent, Map<ExternalToolId, () => Promise<void> | void>>()
  private externalToolProjector: ExternalToolProjector | undefined
  private settings: SettingsForms | undefined

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'agentPresets')
    this.owner = ctx
    ctx.sessionProjections.register(agentPresetProjectionDefinition)
    ctx.sessionProjections.register(externalToolsResolvedProjectionDefinition)
    ctx.inject(['settings'], (child) => {
      this.settings = child.settings
      child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
      child.effect(() => () => { this.settings = undefined }, 'agent-preset-registry: settings')
    })
    ctx.on('agent/created', ({ agent }) => { this.reconcileExternalTools(agent) })
    ctx.on('agent/status', ({ agent }) => { this.reconcileExternalTools(agent) })
    ctx.on('agent/disposed', ({ agent }) => { this.externalToolMounts.delete(agent) })
    ctx.on('agent/request', ({ agent, turn, step }, next) => {
      const previous = ctx.sessionProjections.stateOf(agent.session, 'externalToolsResolved')
      if (previous?.turn !== turn || previous.step !== step) {
        const mounted = this.externalToolMounts.get(agent)
        const tools = (['codex', 'claude-code'] as const).filter(tool => mounted?.has(tool) === true)
        if (tools.length > 0 || previous !== undefined) {
          agent.session.append('external-tools/resolved', { turn, step, tools: [...tools] })
        }
      }
      return next()
    })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'agent-preset/selected') ctx.emit('agent-preset/selected', session.id, event.data.agentPreset)
    })
  }

  /** Default preset for a subsequently created session. */
  get defaultId(): string { return this.config.selectedDefault.get() ?? this.config.default }

  private externalToolsSnapshot(): ExternalToolsState {
    const configured = this.config.externalTools.get()
    return {
      scope: 'complete-presets',
      codex: externalToolEnabled(configured, 'codex'),
      claudeCode: externalToolEnabled(configured, 'claude-code'),
    }
  }

  /** Reconcile an Agent only at publication or a safe status boundary. */
  private reconcileExternalTools(agent: Agent): void {
    const accepted = acceptsExternalTools(this.composedPreset(agent.ctx))
    const state = this.externalToolsSnapshot()
    const projector = this.externalToolProjector
    let mounts = this.externalToolMounts.get(agent)
    for (const tool of ['codex', 'claude-code'] as const) {
      const enabled = accepted && projector !== undefined && (tool === 'codex' ? state.codex : state.claudeCode)
      const mounted = mounts?.get(tool)
      if (enabled && mounted === undefined) {
        mounts ??= new Map()
        mounts.set(tool, projector(agent, tool))
        this.externalToolMounts.set(agent, mounts)
      } else if (!enabled && mounted !== undefined) {
        mounts?.delete(tool)
        void Promise.resolve(mounted()).catch((error: unknown) => {
          this.owner.logger.warn(`agent-preset-registry: failed to remove ${tool} from agent "${agent.id}": ${String(error)}`)
        })
      }
    }
    if (mounts?.size === 0) this.externalToolMounts.delete(agent)
  }

  /** Register the one Desktop Host implementation that mounts connected product tools.
   * @param projector - Host-owned mount function for an idle Agent and enabled tool.
   * @returns Disposer that removes this projector and reconciles idle Agents.
   */
  registerExternalToolProjector(projector: ExternalToolProjector): () => void {
    if (this.externalToolProjector !== undefined) throw new Error('agent-preset-registry: an external-tool projector is already registered')
    this.externalToolProjector = projector
    for (const agent of this.owner.get('agents')?.list() ?? []) {
      if (agent.status === 'idle') this.reconcileExternalTools(agent)
    }
    return () => {
      if (this.externalToolProjector !== projector) return
      this.externalToolProjector = undefined
      for (const agent of this.owner.get('agents')?.list() ?? []) {
        if (agent.status === 'idle') this.reconcileExternalTools(agent)
      }
    }
  }

  /** Read effective Host connections projected into complete presets.
   * @returns The current persisted connection state and eligible preset set.
   */
  externalToolsState(): Promise<ExternalToolsState> {
    return Promise.resolve(this.externalToolsSnapshot())
  }

  /** Persist one connection in the current Profile without interrupting running turns.
   * @param tool - The supported external tool identity.
   * @param enabled - Whether the tool should be projected into eligible Agents.
   * @returns The effective state after the Settings transaction.
   */
  async setExternalTool(tool: ExternalToolId, enabled: boolean): Promise<ExternalToolsState> {
    if (this.settings === undefined) throw new Error('agent-preset-registry: settings service is unavailable')
    const path = tool === 'codex' ? ['externalTools', 'codex'] : ['externalTools', 'claudeCode']
    await this.settings.mutate('agent-preset-registry', [{ op: 'set', path, value: enabled }])
    for (const agent of this.owner.get('agents')?.list() ?? []) {
      if (agent.status === 'idle') this.reconcileExternalTools(agent)
    }
    return this.externalToolsSnapshot()
  }

  /** Register and eagerly load a definition; activation failure remains visible in the roster.
   * @param definition Parsed configuration supplied by the declaring plugin.
   * @returns Definition disposer after activation or its diagnostic settles; the declaring plugin owns it.
   */
  async register(definition: PresetDefinition): Promise<() => Promise<void>> {
    const context = this.ctx
    if (!definition.id.trim()) throw new Error('Preset id must not be empty')
    if (this.definitions.has(definition.id)) throw new Error(`Duplicate agent preset: ${definition.id}`)
    const record: Definition = { config: definition, context, ready: Promise.resolve() }
    this.definitions.set(definition.id, record)
    let disposed = false
    const unregister = async (): Promise<void> => {
      if (disposed) return
      disposed = true
      this.definitions.delete(definition.id)
      await record.ready
      if (record.generation !== undefined) {
        record.generation.retired = true
        await this.collect(record.generation)
      }
    }
    record.ready = this.activate(record)
    await record.ready
    return unregister
  }

  private async activate(record: Definition): Promise<void> {
    const key = {}
    const scope = createScope(this.owner, key)
    try {
      const problem = entryListProblem(record.config.plugins)
      if (problem !== undefined) throw new Error(problem)
      const context = scope.ctx.extend({ baseUrl: record.context.baseUrl })
      const mount = await mountPreset(context, record.config.id, record.config.plugins)
      const generation: Generation = { scope, key, mount, users: 0, retired: false }
      this.generations.set(key, generation)
      record.generation = generation
    } catch (error) {
      record.broken = (error as Error).message
      this.owner.logger.warn(`agent preset ${record.config.id}: ${record.broken}`)
      await scope.dispose()
    }
  }

  /**
   * Current activation diagnostic of a definition.
   *
   * A mount failure is final. A mounted tree is re-audited on every read: a
   * row waiting for a Host service activates by itself once that provider
   * finishes, so the audit waits for the Host Loader tree to settle before
   * reporting the row as unusable. Callers therefore must not run inside a
   * Host row's own activation, which the settlement would wait on.
   * @param record - the definition to audit.
   * @returns one line per unusable row, or undefined when the definition is usable.
   */
  private async diagnostic(record: Definition): Promise<string | undefined> {
    await record.ready
    if (record.generation === undefined) return record.broken
    const tree = record.generation.mount.tree
    let audit = await auditRows(tree)
    if (audit.pending.length > 0) {
      await this.owner.loader.await()
      audit = await auditRows(tree)
    }
    const lines = [...audit.failed, ...audit.pending]
    return lines.length === 0 ? undefined : lines.join('\n')
  }

  private async collect(generation: Generation): Promise<void> {
    if (!generation.retired || generation.users !== 0) return
    this.generations.delete(generation.key)
    await generation.scope.dispose()
  }

  /** Read every declared preset, including activation failures.
   * @returns Display metadata and loading diagnostics.
   */
  async list(): Promise<AgentPreset[]> {
    const rows = await Promise.all([...this.definitions.values()].map(async (record) => {
      const broken = await this.diagnostic(record)
      return {
        id: record.config.id,
        ...(record.config.name === undefined ? {} : { name: record.config.name }),
        ...(record.config.description === undefined ? {} : { description: record.config.description }),
        ...(record.config.order === undefined ? {} : { order: record.config.order }),
        ...(broken === undefined ? {} : { broken }),
      }
    }))
    return rows.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.id.localeCompare(b.id))
  }

  /** Read the selection roster.
   * @returns Current presets, each marked when it is the default.
   */
  @Remote('list')
  async remoteExportList(): Promise<AgentPresetRoster> {
    const defaultId = this.defaultId
    return { presets: (await this.list()).map(row => ({ ...row, isDefault: row.id === defaultId })) }
  }

  /** Resolve an identity without starting an Agent.
   * @param id Explicit preset or the current default.
   * @returns Current metadata, including failure when activation failed.
   */
  async resolve(id?: string): Promise<AgentPreset> {
    const wanted = id ?? this.defaultId
    const record = this.definitions.get(wanted)
    if (record === undefined) throw new RemoteError('agent-preset/not-found', `Unknown agent preset: ${wanted}`,
      { agentPreset: wanted, available: [...this.definitions.keys()] })
    const broken = await this.diagnostic(record)
    return { id: wanted, ...(broken === undefined ? {} : { broken }) }
  }

  /** Read one declaration's child plugin list as YAML, for viewing only.
   * @param agentPreset Preset identity.
   * @returns The declared composition beside its published metadata.
   */
  @Remote('read')
  readDocument(agentPreset: string): Promise<AgentPresetDocument> {
    const record = this.definitions.get(agentPreset)
    if (record === undefined) {
      return Promise.reject(new RemoteError('agent-preset/not-found', `Unknown agent preset: ${agentPreset}`,
        { agentPreset, available: [...this.definitions.keys()] }))
    }
    const { id, name, description, plugins } = record.config
    // The Loader's own dialect, so `!!js` conditions read as declared rather than as expression objects.
    const content = dump(plugins, { schema: entryListSchema, noRefs: true, lineWidth: -1 })
    return Promise.resolve({
      agentPreset: id, content, ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }),
    })
  }

  private async retain(id?: string): Promise<Generation> {
    const wanted = id ?? this.defaultId
    while (true) {
      const record = this.definitions.get(wanted)
      if (record === undefined) throw new RemoteError('agent-preset/not-found', `Unknown agent preset: ${wanted}`,
        { agentPreset: wanted, available: [...this.definitions.keys()] })
      const broken = await this.diagnostic(record)
      if (this.definitions.get(wanted) !== record) continue
      const generation = record.generation
      if (broken !== undefined || generation === undefined) {
        const reason = broken as string
        throw new RemoteError('agent-preset/invalid', reason, { agentPreset: wanted, reason })
      }
      generation.users++
      return generation
    }
  }

  private async bind(ctx: Context, generation: Generation): Promise<void> {
    const key = scopeOf(ctx)
    if (key === undefined) throw new Error('Agent preset binding requires a scoped context')
    const binding = this.bindings.get(key)
    if (binding?.generation === generation) return
    if (binding !== undefined) {
      binding.parent.rebind(generation.key)
      const old = binding.generation
      generation.users++
      binding.generation = generation
      old.users--
      await this.collect(old)
    } else this.join(ctx, key, generation)
  }

  private join(ctx: Context, key: ScopeKey, generation: Generation): void {
    const binding = { parent: bindScopeParent(key, generation.key), generation }
    generation.users++
    this.bindings.set(key, binding)
    ctx.effect(() => async () => {
      this.bindings.delete(key)
      binding.generation.users--
      await this.collect(binding.generation)
    }, 'agent-preset.binding')
  }

  /** Bind an unpublished Agent to the current preset revision.
   * @param ctx Agent context from its setup callback.
   * @param id Requested preset, or the default.
   * @returns Bound preset identity.
   */
  async mount(ctx: Context, id?: string): Promise<AgentPreset> {
    const generation = await this.retain(id)
    try {
      await this.bind(ctx, generation)
      return { id: generation.mount.presetId }
    } finally {
      generation.users--
      await this.collect(generation)
    }
  }

  /** Join a child to the exact revision retained by its parent.
   * @param ctx Child Agent context.
   * @param parent Parent Agent context.
   * @returns Inherited preset id, or undefined in a preset-free composition.
   */
  composeFrom(ctx: Context, parent: Context): string | undefined {
    const mounted = standingMountFor(parent)
    if (mounted === undefined) return undefined
    const generation = this.generations.get(mounted.key)
    if (generation === undefined) throw new Error('Parent preset revision is unavailable')
    // A child has no existing binding, so this path has no asynchronous cleanup.
    const key = scopeOf(ctx)
    if (key === undefined) throw new Error('Child preset binding requires a scope')
    if (this.bindings.has(key)) throw new Error('Child already joined a preset')
    this.join(ctx, key, generation)
    return mounted.presetId
  }

  /** Read the preset a live Agent uses.
   * @param ctx Agent context.
   * @returns Its preset id, if bound.
   */
  composedPreset(ctx: Context): string | undefined { return standingMountFor(ctx)?.presetId }

  /** Read a service supplied inside an Agent's isolated preset group.
   * @param agent Agent whose composition is queried.
   * @param name Cordis service name.
   * @returns The service, or undefined.
   */
  serviceFor<K extends string & keyof Context>(agent: { ctx: Context }, name: K): Context[K] | undefined {
    return serviceForAgent(this.owner, agent, name)
  }

  /** Rebind a blank Agent; the caller owns the blank-session check.
   * @param ctx Agent context.
   * @param id Requested preset.
   * @returns The bound identity.
   */
  async recompose(ctx: Context, id: string): Promise<AgentPreset> {
    const preset = await this.mount(ctx, id)
    const agent = this.owner.get('agents')?.list().find(candidate => candidate.ctx === ctx)
    if (agent !== undefined && agent.status === 'idle') this.reconcileExternalTools(agent)
    try { this.owner.emit('tools/change') }
    catch (error) { this.owner.logger.warn(`Preset tools observer: ${String(error)}`) }
    return preset
  }

  /** Select a preset before a session starts its first turn.
   * @param agent Target Agent.
   * @param agentPreset Requested identity.
   * @returns Committed preset identity.
   */
  @Remote('select')
  async select(agent: Agent, agentPreset: string): Promise<string> {
    const turn = (this.switches.get(agent.id) ?? Promise.resolve()).then(async () => {
      const boundary = this.owner.sessionProjections.stateOf(agent.session, 'turnBoundary')
      if (boundary !== undefined && (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0)) {
        throw new RemoteError('agent-preset/locked', 'This session has already started', { sessionId: agent.id, agentPreset })
      }
      const preset = await this.recompose(agent.ctx, agentPreset)
      agent.session.append('agent-preset/selected', { agentPreset: preset.id })
      return preset.id
    })
    const guard = turn.catch(() => undefined)
    this.switches.set(agent.id, guard)
    try { return await turn } finally {
      if (this.switches.get(agent.id) === guard) this.switches.delete(agent.id)
    }
  }

  /** Read current registrations for cold transcript presentation.
   * @param id Preset identity or the default.
   * @returns A revision lease; dispose it after the scoped read completes.
   */
  async acquireScope(id?: string): Promise<{ key: ScopeKey } & AsyncDisposable> {
    const generation = await this.retain(id)
    let disposed = false
    return { key: generation.key, [Symbol.asyncDispose]: async () => {
      if (disposed) return
      disposed = true
      generation.users--
      await this.collect(generation)
    } }
  }

  /** Read plugin rows without creating an Agent.
   * @returns Current declaration metadata and activation states.
   */
  compositionInventory(): Promise<AgentPresetComposition[]> {
    return Promise.all([...this.definitions.values()].map(async (record) => {
      const { id, name, description } = record.config
      const broken = await this.diagnostic(record)
      const read = definitionComposition(record.config.plugins, () => { throw new Error('Inactive definition') })
      return { id, ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }),
        isDefault: id === this.defaultId,
        ...(broken === undefined ? {} : { broken }),
        rows: record.generation === undefined ? ('rows' in read ? read.rows : []) : mountedCompositionRows(record.generation.mount.tree) }
    }))
  }
}
export default AgentPresetRegistry
