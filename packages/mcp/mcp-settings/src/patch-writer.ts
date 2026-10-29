/**
 * Comment-preserving edits to MCP insertions in the current Profile patch.
 * Writes share the Profile file lock and HMR exclusive execution. A failed live
 * activation restores the prior document and runtime; without HMR, activation
 * waits until the next startup. Unknown configuration fields remain on disk.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: `ctx.get('hmr')` and `ctx.profileContext` are declared by these
// faces (matches packages/boot/config-editor's imports of the same).
import type {} from '@deepseek-ai/dsh-hmr'
import { readProfilePatches, reconcileProfilePatches } from '@deepseek-ai/dsh-app-boot'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { isMap, isSeq, parseDocument, type Document } from 'yaml'
import type { McpServerConfig } from './types.ts'

/** The insert container id prefix for panel-managed servers. */
const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/**
 * Derive the stable Loader id used by existing and built-in MCP settings.
 * @param serverName Validated MCP namespace.
 * @returns Profile entry id prefixed with `mcp-`.
 */
function entryId(serverName: string): string {
  return `mcp-${serverName}`
}

function loadDocument(text: string): Document {
  const document = parseDocument(text, {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
  })
  const error = document.errors[0]
  if (error !== undefined) throw error
  if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
  document.contents.flow = false
  return document
}

async function readPatchText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '[]\n'
    throw error
  }
}

/** The `{ id, name, config }` maps inside one `{ insert: [...] }` row. */
function insertRows(item: unknown): import('yaml').YAMLMap[] {
  if (!isMap(item)) return []
  const insert = item.get('insert')
  return isSeq(insert) ? insert.items.filter(isMap) : []
}

/** Find the index of the `{ insert: [...] }` row that carries a given entry id. */
function findInsertIndex(document: Document, id: string): number {
  const items = (document.contents as import('yaml').YAMLSeq).items
  for (let index = items.length - 1; index >= 0; index--) {
    if (insertRows(items[index]).some(row => row.get('id') === id)) return index
  }
  return -1
}

/** Read the `{ id, name, config }` map for a given entry id, if present. */
function findInsertEntry(document: Document, id: string): import('yaml').YAMLMap | undefined {
  const index = findInsertIndex(document, id)
  if (index < 0) return undefined
  return insertRows((document.contents as import('yaml').YAMLSeq).items[index]).find(row => row.get('id') === id)
}

/**
 * Add (or replace) one MCP server entry, then reconcile.
 * @param ctx - host context with `profileContext`, `root`, and optional `hmr`.
 * @param serverName - the MCP namespace; becomes the entry id `mcp-<serverName>`.
 * @param config - the resolved MCP client config to persist.
 * @returns `applied` when HMR recomposed the fiber, `restart-required` otherwise.
 */
export async function upsertServer(ctx: Context, serverName: string, config: McpServerConfig): Promise<'applied' | 'restart-required'> {
  return mutate(ctx, serverName, (document) => {
    const id = entryId(serverName)
    const existing = findInsertEntry(document, id)
    if (existing !== undefined) {
      if (existing.get('name') !== MCP_CLIENT_MODULE) throw new Error('MCP entry id belongs to another plugin')
      const previous = existing.get('config')
      if (!isMap(previous)) throw new Error('MCP configuration is not a mapping')
      for (const [key, value] of Object.entries(config)) previous.set(key, document.createNode(value))
      return
    }
    // Append a fresh insert row carrying exactly this server.
    ;(document.contents as import('yaml').YAMLSeq).add(
      document.createNode({ insert: [{ id, name: MCP_CLIENT_MODULE, config }] }),
    )
  })
}

/**
 * Remove one panel-managed MCP server entry, then reconcile.
 * @param ctx - host context.
 * @param serverName - the namespace of the entry to delete.
 * @returns the application outcome.
 */
export async function removeServer(ctx: Context, serverName: string): Promise<'applied' | 'restart-required'> {
  const id = entryId(serverName)
  return mutate(ctx, serverName, (document) => {
    const seq = document.contents as import('yaml').YAMLSeq
    const index = findInsertIndex(document, id)
    if (index < 0) {
      // The row is not owned by this patch file (a bundle/base layer): disable it.
      seq.add(document.createNode({ id, disabled: true }))
      return
    }
    const container = seq.items[index] as import('yaml').YAMLMap
    const kept = insertRows(container).filter(row => row.get('id') !== id)
    if (kept.length === 0) seq.delete(index)
    else container.set('insert', document.createNode(kept))
    for (let index = seq.items.length - 1; index >= 0; index--) {
      const row = seq.items[index]
      if (isMap(row) && !row.has('insert') && row.get('id') === id && (!row.has('name') || row.get('name') === MCP_CLIENT_MODULE)) seq.delete(index)
    }
  })
}

/**
 * Toggle one server's enablement by writing a `{ id, disabled }` override row.
 * @param ctx - host context.
 * @param serverName - the namespace to toggle.
 * @param enabled - desired state.
 * @returns the application outcome.
 */
export async function setServerEnabled(ctx: Context, serverName: string, enabled: boolean): Promise<'applied' | 'restart-required'> {
  const id = entryId(serverName)
  return mutate(ctx, serverName, (document) => {
    const seq = document.contents as import('yaml').YAMLSeq
    const items = seq.items
    const target = items.findLast((item, index) => {
      if (!isMap(item) || document.getIn([index, 'id']) !== id || item.has('insert')) return false
      const expected = document.getIn([index, 'name'])
      return !expected || expected === MCP_CLIENT_MODULE
    })
    if (isMap(target)) target.set('disabled', !enabled)
    else seq.add(document.createNode({ id, disabled: !enabled }))
  })
}

/**
 * Apply one document mutation under the profile lock, persist it, and reconcile.
 * @param ctx - host context.
 * @param serverName - the affected namespace (drives the entry id and reconcile target).
 * @param edit - a synchronous edit against the parsed document.
 * @returns the application outcome.
 */
async function mutate(ctx: Context, serverName: string, edit: (document: Document) => void): Promise<'applied' | 'restart-required'> {
  const profile = ctx.profileContext
  const path = profile.patchPath
  const run = async (): Promise<'applied' | 'restart-required'> => {
    await withFileLock(join(profile.dir, 'package.json'), async () => {
      const before = await readPatchText(path)
      const document = loadDocument(before)
      edit(document)
      await writeFileAtomic(path, String(document), { mode: 0o600 })
      if (ctx.get('hmr') === undefined) return
      try {
        const patches = readProfilePatches('dsh', profile)
        await reconcileProfilePatches(ctx.root, patches, 'dsh', [entryId(serverName)])
      } catch (error) {
        // Roll the file back so a failed activation never leaves a broken patch.
        try {
          await writeFileAtomic(path, before, { mode: 0o600 })
          const rollback = readProfilePatches('dsh', profile)
          await reconcileProfilePatches(ctx.root, rollback, 'dsh')
        }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], 'MCP update and runtime rollback failed') }
        throw error
      }
    })
    return 'applied'
  }
  const hmr = ctx.get('hmr')
  if (hmr === undefined) {
    // No HMR service: the write is durable but takes effect on next boot.
    await run()
    return 'restart-required'
  }
  return await hmr.runExclusive(run)
}

export { entryId }

/**
 * The entry ids the profile patch owns via `insert` rows (i.e. panel-managed
 * servers, as opposed to rows contributed by a bundle or a command overlay).
 * @param ctx - host context with `profileContext`.
 * @returns a set of `{ id, serverName }` for panel-managed servers.
 */
export async function listManagedServers(ctx: Context): Promise<Map<string, string>> {
  const path = ctx.profileContext.patchPath
  const document = loadDocument(await readPatchText(path))
  const managed = new Map<string, string>()
  for (const item of (document.contents as import('yaml').YAMLSeq).items) {
    for (const row of insertRows(item)) {
      const id = row.get('id')
      const name = row.get('name')
      if (typeof id === 'string' && name === MCP_CLIENT_MODULE) managed.set(id, id.replace(/^mcp-/, ''))
    }
  }
  return managed
}
