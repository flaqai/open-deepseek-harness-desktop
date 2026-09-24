/** Validated coordinates used by the desktop external-tool installer. */

export const EXTERNAL_TOOL_IDS = ['codex', 'claude-code'] as const

export type DesktopExternalToolId = typeof EXTERNAL_TOOL_IDS[number]

export interface ExternalToolRuntimePackage {
  readonly packageName: string
  readonly version: string
  readonly integrity: string
  readonly verifyOptionalPlatformPackages: boolean
}

interface ExternalToolCoordinate {
  readonly packageName: string
  readonly version: string
  readonly integrity: string
  readonly runtimePackage: ExternalToolRuntimePackage
}

export interface ExternalToolCompatibilityManifest {
  readonly schema: 'dsh/desktop-external-tool-compatibility/v2'
  readonly revision: number
  readonly desktopVersion: string
  readonly reviewedSourceVersion: string
  readonly issuedAt: string
  readonly expiresAt: string
  readonly tools: Readonly<Record<DesktopExternalToolId, ExternalToolCoordinate>>
}

export type ExternalToolCompatibilitySource = 'remote' | 'cache' | 'embedded'

export interface ExternalToolInstallResolution {
  readonly toolId: DesktopExternalToolId
  readonly packageName: string
  readonly version: string
  readonly packageSpec: string
  readonly integrity: string
  readonly source: ExternalToolCompatibilitySource
  readonly revision: number
}

/** Last-known-good pins shipped in the application and used only after signed lookup fails. */
export const EMBEDDED_EXTERNAL_TOOL_COMPATIBILITY: ExternalToolCompatibilityManifest = {
  schema: 'dsh/desktop-external-tool-compatibility/v2',
  revision: 9,
  desktopVersion: '0.1.7-rc.1',
  reviewedSourceVersion: '0.1.7-rc.1',
  issuedAt: '2026-09-24T00:00:00.000Z',
  expiresAt: '2027-03-23T00:00:00.000Z',
  tools: {
    codex: {
      packageName: '@deepseek-ai/dsh-subagent-codex',
      version: '0.1.7-rc.1',
      integrity: 'sha512-gA8zXDCagkdX4N2FEZuQQiIdcKcWPCZwNPMYMT2d6uaAOWaTognDpvL2BcImEOrD3ebXkmZ17ObZj7cu/khflw==',
      runtimePackage: {
        packageName: '@openai/codex',
        version: '0.153.4',
        integrity: 'sha512-wbHDmit7S/YvBGVX1DQmk13xtWblZ2cApeJ/pB7xDZ10Cna+DZc5ij7f0F4OxdsXN4FW1oLT48OpogUI1+8Y2w==',
        verifyOptionalPlatformPackages: true,
      },
    },
    'claude-code': {
      packageName: '@deepseek-ai/dsh-subagent-claude-code',
      version: '0.1.7-rc.1',
      integrity: 'sha512-fJZ3t2IfOerdMsDpq+d0h8MdWyaZdPRmx1tmjBPGDamrHsWQJ6PEC5f6tAzTbeu24+EDl60SKia0axCfWKtbeQ==',
      runtimePackage: {
        packageName: '@anthropic-ai/claude-agent-sdk',
        version: '0.3.263',
        integrity: 'sha512-0QWoHgWWlSmgXfEqZRbVYRoXT9p4tx/yKaZ4eLJ8l1MR65SIvMGR+cd5ZXUpGYZpj9RzbYiYU9LoFg90mdIjmw==',
        verifyOptionalPlatformPackages: true,
      },
    },
  },
}

const PACKAGE_NAME = /^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/u
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u
const INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/u

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`desktop: ${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireString(record: Record<string, unknown>, key: string, pattern?: RegExp): string {
  const value = record[key]
  if (typeof value !== 'string' || value === '' || (pattern !== undefined && !pattern.test(value))) {
    throw new TypeError(`desktop: external-tool manifest has invalid ${key}`)
  }
  return value
}

function parseRuntimePackage(value: unknown): ExternalToolRuntimePackage {
  const record = requireRecord(value, 'external-tool runtime package')
  if (record.verifyOptionalPlatformPackages !== true) {
    throw new TypeError('desktop: external-tool runtime package must verify optional platform packages')
  }
  return {
    packageName: requireString(record, 'packageName', PACKAGE_NAME),
    version: requireString(record, 'version', VERSION),
    integrity: requireString(record, 'integrity', INTEGRITY),
    verifyOptionalPlatformPackages: true,
  }
}

function parseCoordinate(value: unknown): ExternalToolCoordinate {
  const record = requireRecord(value, 'external-tool coordinate')
  return {
    packageName: requireString(record, 'packageName', PACKAGE_NAME),
    version: requireString(record, 'version', VERSION),
    integrity: requireString(record, 'integrity', INTEGRITY),
    runtimePackage: parseRuntimePackage(record.runtimePackage),
  }
}

/** Parse the signed compatibility document without accepting package-spec syntax. */
export function parseExternalToolCompatibilityManifest(value: unknown): ExternalToolCompatibilityManifest {
  const record = requireRecord(value, 'external-tool manifest')
  if (record.schema !== 'dsh/desktop-external-tool-compatibility/v2') {
    throw new TypeError('desktop: unsupported external-tool manifest schema')
  }
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 1) {
    throw new TypeError('desktop: external-tool manifest revision must be a positive integer')
  }
  const issuedAt = requireString(record, 'issuedAt')
  const expiresAt = requireString(record, 'expiresAt')
  if (!Number.isFinite(Date.parse(issuedAt)) || !Number.isFinite(Date.parse(expiresAt))) {
    throw new TypeError('desktop: external-tool manifest timestamps are invalid')
  }
  const tools = requireRecord(record.tools, 'external-tool tools')
  if (Object.keys(tools).some(key => !EXTERNAL_TOOL_IDS.includes(key as DesktopExternalToolId))) {
    throw new TypeError('desktop: external-tool manifest contains an unsupported tool')
  }
  return {
    schema: record.schema,
    revision: record.revision as number,
    desktopVersion: requireString(record, 'desktopVersion', VERSION),
    reviewedSourceVersion: requireString(record, 'reviewedSourceVersion', VERSION),
    issuedAt,
    expiresAt,
    tools: {
      codex: parseCoordinate(tools.codex),
      'claude-code': parseCoordinate(tools['claude-code']),
    },
  }
}

/** Resolve one closed tool identifier to an exact registry coordinate. */
export function resolveExternalToolCoordinate(
  manifest: ExternalToolCompatibilityManifest,
  toolId: DesktopExternalToolId,
  source: ExternalToolCompatibilitySource,
): ExternalToolInstallResolution {
  const coordinate = manifest.tools[toolId]
  return {
    toolId,
    packageName: coordinate.packageName,
    version: coordinate.version,
    packageSpec: `${coordinate.packageName}@${coordinate.version}`,
    integrity: coordinate.integrity,
    source,
    revision: manifest.revision,
  }
}
