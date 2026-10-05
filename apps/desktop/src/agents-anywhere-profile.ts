/** First-install policy for the optional Agents Anywhere bridge. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isMap, isSeq, parseDocument } from 'yaml'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

export const AGENTS_ANYWHERE_PACKAGE = '@agents-anywhere/dsh-bridge-next'
export const AGENTS_ANYWHERE_ROW = 'agents-anywhere-bridge-next'

/** Detect a user's existing Pocket dependency without changing its package or configuration. */
export async function hasLegacyPocket(home: string): Promise<boolean> {
  try {
    const packageJson = JSON.parse(await readFile(join(home, 'profiles', 'web', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, unknown>
    }
    return typeof packageJson.dependencies?.['dsh-pocket'] === 'string'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Leave an already configured bridge untouched, including a user's enablement. */
export async function configureNewAgentsAnywhere(home: string, profileHome: string): Promise<boolean> {
  const filename = join(profileHome, 'profiles', 'web', 'cordis.patch.yml')
  let source: string
  try { source = await readFile(filename, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    source = '[]\n'
  }
  const document = parseDocument(source, {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
  })
  if (document.errors.length > 0 || !isSeq(document.contents)) {
    throw new Error('desktop: invalid Web Profile patch while configuring remote control')
  }
  if (document.contents.items.some((item, index) => isMap(item)
    && document.getIn([index, 'id']) === AGENTS_ANYWHERE_ROW)) return false
  document.add({
    id: AGENTS_ANYWHERE_ROW,
    disabled: true,
    config: { dshHome: home, stateRoot: join(home, 'agents-anywhere') },
  })
  await writeFileAtomic(filename, String(document), { mode: 0o600 })
  return true
}
