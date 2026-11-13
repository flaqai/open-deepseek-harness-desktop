/** Profile adapter for a verified, application-managed Python runtime and bundled Office skills. */

import { resolveWorkspaceDependencies } from './payload.ts'
import type { Context } from '@deepseek-ai/cordis'
import * as officeSkills from '@deepseek-ai/dsh-skill-office'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Metadata stored at the root of each verified optional runtime payload. */
export interface WorkspaceRuntimePayloadManifest {
  readonly schema: 'dsh/workspace-runtime-payload/v1'
  readonly desktopVersion: string
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly payloadDigest: string
  readonly pythonVersion: string
  readonly pythonPackages: Readonly<Record<string, string>>
}

/** Absolute paths exposed to model-facing Office workflows. */
export interface WorkspaceDependencies {
  readonly python: string
  readonly node: string
  readonly pnpm: string
  readonly pythonPackages: string
  readonly nodePackages: string
  readonly pythonDistributions: Readonly<Record<string, string>>
}

/** Application-owned paths. Renderer input never reaches these fields. */
export interface Config {
  /** Absolute root of the verified managed payload containing `runtime.json`. */
  readonly runtimeRoot: string
  /** Absolute executable path for an optional user-selected Python interpreter. */
  readonly python?: string
  /** Absolute site-packages directory belonging to the user-selected interpreter. */
  readonly pythonPackages?: string
  /** Installed distribution versions belonging to the user-selected interpreter. */
  readonly pythonDistributions?: Readonly<Record<string, string>>
  /** Absolute executable path for the application-packaged Node.js runtime. */
  readonly node: string
  /** Absolute entry-point path for the application-packaged pnpm runtime. */
  readonly pnpm: string
  /** Absolute node_modules directory exposed to Workspace dependency consumers. */
  readonly nodePackages: string
  /** Whether to register the packaged Office skills for this Profile. */
  readonly office?: boolean
}

export const name = 'host-workspace-runtime'
export const inject = ['tools']

/**
 * Register the dependency-path tool and, when requested, the bundled Office skill provider.
 * @param ctx - Profile scope that owns tools and skills.
 * @param config - Paths selected by the trusted Desktop main process.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const dependencies = await resolveWorkspaceDependencies(config)
  ctx.tools.register(defineTool({
    name: 'load_workspace_dependencies',
    description: 'Get absolute paths to the installed Python, packaged Node.js and pnpm runtimes, plus their library directories and Python distribution versions. Use these paths explicitly; this tool does not change PATH or package-manager settings.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          python: { type: 'string', required: true }, node: { type: 'string', required: true },
          pnpm: { type: 'string', required: true }, pythonPackages: { type: 'string', required: true },
          nodePackages: { type: 'string', required: true },
          pythonDistributions: { type: 'object', additionalProperties: true, required: true },
        },
      },
      render: (_args, output) => [{ type: 'text', text: JSON.stringify(output, undefined, 2) }],
    },
    execute: () => Promise.resolve(dependencies),
    presentCall: () => ({ card: 'generic', title: 'Load workspace dependencies', kind: 'read' }),
  }))
  if (config.office === true) await ctx.plugin(officeSkills, { pythonEnvironment: 'workspace-dependencies' })
}
