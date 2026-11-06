/** Measure cold npm archive downloads for the fixed capability install targets; never execute package scripts. */
import { readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'
import { maxSatisfying } from 'semver'

const source = ts.createSourceFile('index.ts', readFileSync('packages/host/plugin-inventory/src/index.ts', 'utf8'), ts.ScriptTarget.Latest, true)
function literal(node: ts.Expression): unknown {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression)
  if (ts.isStringLiteral(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(item => literal(item))
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map((item) => {
    if (!ts.isPropertyAssignment(item)) throw new Error('Nonliteral recipe property')
    return [item.name.getText().replace(/^['"]|['"]$/g, ''), literal(item.initializer)]
  }))
  throw new Error('Nonliteral recipe expression')
}
/** Read generated/configuration literals as data without importing a Client compiler program. */
function readConstant(file: string, name: string): unknown {
  const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  let result: unknown
  function find(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      result = literal(node.initializer)
    }
    ts.forEachChild(node, find)
  }
  find(tree)
  if (result === undefined) throw new Error(`Missing literal ${name} in ${file}`)
  return result
}
const clientDirectory = 'packages/client/ui-settings-plugin-inventory/src/client/'
const DIRECT_EXTERNAL_TOOL_SPECS = readConstant(clientDirectory + 'external-tool-compatibility-bridge.ts',
  'DIRECT_EXTERNAL_TOOL_SPECS') as Record<string, string>
interface StoredDownloads {
  schema: number
  scope: string
  choices: Record<string, { specs: string[]; targets: Record<string, { downloadBytes: number | null; packageCount: number }> }>
}
let recipes: Record<string, { packageSpec: string; dependencies: string[] }> = {}
function visit(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'EXPERIMENTAL_CAPABILITY_RECIPES' && node.initializer) {
    recipes = literal(node.initializer) as typeof recipes
  }
  ts.forEachChild(node, visit)
}
visit(source)
if (Object.keys(recipes).length !== 4) throw new Error('Unexpected capability recipe roster')
function directSpec(id: string): string {
  const spec = DIRECT_EXTERNAL_TOOL_SPECS[id]
  if (typeof spec !== 'string') throw new Error(`Missing direct installation target: ${id}`)
  return spec
}
const choices: Record<string, string[]> = {
  'browser-use-playwright-attach': [directSpec('browser-use-playwright')],
  'browser-use-devtools-attach': [directSpec('browser-use-devtools')],
  'browser-use-stagehand': [directSpec('browser-use-stagehand')],
  'auto-review': [directSpec('auto-review')],
  workbuddy: [directSpec('workbuddy')],
}
for (const [id, recipe] of Object.entries(recipes)) choices[id] = [recipe.packageSpec, ...recipe.dependencies]
const desktopVersion = (JSON.parse(readFileSync('apps/desktop/package.json', 'utf8')) as { version: string }).version
const manifest = JSON.parse(readFileSync(`apps/desktop/external-tools/manifests/${desktopVersion}/external-tools-compatibility.v2.json`, 'utf8')) as { tools: Record<string, { packageName: string; version: string; runtimePackage: { packageName: string; version: string } }> }
for (const id of ['codex', 'claude-code']) {
  const tool = manifest.tools[id]
  if (tool === undefined) throw new Error(`Missing compatibility tool: ${id}`)
  choices[id] = [`${tool.packageName}@${tool.version}`, `${tool.runtimePackage.packageName}@${tool.runtimePackage.version}`]
}
if (process.argv.includes('--check')) {
  const downloadSizeData = readConstant(clientDirectory + 'download-size-data.ts', 'downloadSizeData') as StoredDownloads
  if (downloadSizeData.schema !== 1 || downloadSizeData.scope !== 'npm-tarballs-no-cache'
    || JSON.stringify(Object.keys(downloadSizeData.choices).sort()) !== JSON.stringify(Object.keys(choices).sort())) {
    throw new Error('Capability download size roster is stale')
  }
  for (const [id, specs] of Object.entries(choices)) {
    const stored = downloadSizeData.choices[id]
    if (stored === undefined) throw new Error(`Missing download size: ${id}`)
    if (JSON.stringify(stored.specs) !== JSON.stringify(specs)) throw new Error(`Capability target changed: ${id}; regenerate sizes`)
    for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']) {
      const row = stored.targets[target]
      if (!row || (row.downloadBytes !== null && (!Number.isSafeInteger(row.downloadBytes) || row.downloadBytes <= 0))
        || !Number.isSafeInteger(row.packageCount) || row.packageCount < 0) throw new Error(`Invalid size: ${id}/${target}`)
    }
  }
  console.log('Capability download targets and size records are consistent')
  process.exit(0)
}
interface PackageData {
  name: string
  version: string
  dependencies?: Record<string,string>
  optionalDependencies?: Record<string,string>
  os?: string[]
  cpu?: string[]
  libc?: string[]
  scripts?: Record<string,string>
  dist?: { tarball?: string }
}
interface Metadata { versions: Record<string,PackageData>; 'dist-tags'?: Record<string,string> }
const metadata = new Map<string, Promise<Metadata>>()
const lengths = new Map<string, Promise<number | null>>()
let active = 0
const waiting: Array<() => void> = []
async function request(url: string, headers?: Record<string,string>): Promise<Response> {
  if (active >= 10) await new Promise<void>(resolve => waiting.push(resolve))
  active++
  try {
    const response = await fetch(url, { ...(headers === undefined ? {} : { headers }), signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`)
    // Callers consume metadata immediately; archive probes cancel the body.
    return response
  } finally { active--; waiting.shift()?.() }
}
function packageMetadata(name: string): Promise<Metadata> {
  let pending = metadata.get(name)
  if (!pending) {
    pending = request(`https://registry.npmjs.org/${encodeURIComponent(name)}`).then(response => response.json() as Promise<Metadata>)
    metadata.set(name, pending)
  }
  return pending
}
function archiveLength(url: string): Promise<number | null> {
  if (!url.startsWith('https://registry.npmjs.org/')) return Promise.resolve(null)
  let pending = lengths.get(url)
  if (!pending) {
    pending = request(url, { Range: 'bytes=0-0' }).then(async (response) => {
      const total = response.status === 206 ? Number(response.headers.get('content-range')?.split('/')[1]) : Number(response.headers.get('content-length'))
      await response.body?.cancel()
      return Number.isSafeInteger(total) && total > 0 ? total : null
    })
    lengths.set(url, pending)
  }
  return pending
}
function supports(values: string[] | undefined, target: string): boolean {
  if (!values) return true
  return !values.includes(`!${target}`) && (!values.some(value => !value.startsWith('!')) || values.includes(target) || values.includes('any'))
}
const targets = [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64'], ['linux', 'x64']] as const
const result: Record<string, unknown> = {}
for (const [id, specs] of Object.entries(choices)) {
  const measured: Record<string, unknown> = {}
  for (const [os, cpu] of targets) {
    const visited = new Set<string>(); const warnings = new Set<string>()
    const measurement = { total: 0, incomplete: false }
    async function walk(spec: string, optional = false): Promise<void> {
      try {
        const split = spec.lastIndexOf('@'); const name = spec.slice(0, split); const range = spec.slice(split + 1)
        if (split <= 0 || !name || !range) throw new Error(`Unsupported dependency ${spec}`)
        const info = await packageMetadata(name)
        const version = info.versions[range] ? range : info['dist-tags']?.[range] ?? maxSatisfying(Object.keys(info.versions), range, { includePrerelease: true })
        if (!version) throw new Error(`Unresolved dependency ${spec}`)
        const pkg = info.versions[version]
        if (pkg === undefined) throw new Error(`Missing registry version: ${spec}`)
        if (!supports(pkg.os, os) || !supports(pkg.cpu, cpu) || (os === 'linux' && !supports(pkg.libc, 'glibc'))) { if (!optional) warnings.add(`Unsupported platform: ${spec}`); return }
        const key = `${name}@${version}`
        if (visited.has(key)) return
        visited.add(key)
        const bytes = pkg.dist?.tarball ? await archiveLength(pkg.dist.tarball) : null
        if (bytes === null) measurement.incomplete = true
        else measurement.total += bytes
        if (pkg.scripts?.install || pkg.scripts?.postinstall || pkg.scripts?.preinstall) warnings.add(`Install script: ${key}`)
        const deps = { ...pkg.dependencies, ...pkg.optionalDependencies }
        await Promise.all(Object.entries(deps).map(([dependency, requirement]) => walk(requirement.startsWith('npm:') ? requirement.slice(4) : `${dependency}@${requirement}`, Object.hasOwn(pkg.optionalDependencies ?? {}, dependency))))
      } catch (error) {
        measurement.incomplete = true
        warnings.add(error instanceof Error ? error.message : String(error))
      }
    }
    await Promise.all(specs.map(spec => walk(spec)))
    if (id === 'computer-use-mcp') warnings.add('The standalone CUA Driver application is not measured by npm archive metadata')
    measured[`${os}-${cpu}`] = { downloadBytes: measurement.incomplete ? null : measurement.total, additionalUnknown: warnings.size > 0, packageCount: visited.size, warnings: [...warnings].sort() }
    console.log(id, os, cpu, measurement.incomplete ? 'unknown' : measurement.total, visited.size)
  }
  result[id] = { specs, targets: measured }
}
function render(value: unknown, depth = 0): string {
  const indent = '  '.repeat(depth)
  if (typeof value === 'string') return "'" + value.replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'"
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return value.length === 0 ? '[]'
    : '[\n' + value.map(item => indent + '  ' + render(item, depth + 1) + ',').join('\n') + '\n' + indent + ']'
  if (typeof value !== 'object') throw new Error('Unsupported generated size value')
  return '{\n' + Object.entries(value).map(([key, entry]) => indent + '  ' + render(key) + ': ' + render(entry, depth + 1) + ',').join('\n')
    + '\n' + indent + '}'
}
const declaration = `/** Generated cold npm archive estimates. Refresh with scripts/generate-capability-download-sizes.ts. */
export const downloadSizeData: {
  schema: number
  generatedAt: string
  scope: string
  choices: Record<string, {
    specs: readonly string[]
    targets: Record<string, {
      downloadBytes: number | null
      additionalUnknown: boolean
      packageCount: number
      warnings: readonly string[]
    }>
  }>
} = `
writeFileSync('packages/client/ui-settings-plugin-inventory/src/client/download-size-data.ts', declaration + render({
  schema: 1, generatedAt: new Date().toISOString(), scope: 'npm-tarballs-no-cache', choices: result,
}) + '\n')
