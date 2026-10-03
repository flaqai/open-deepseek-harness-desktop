/** Build dynamic client libraries without discarding the active client build profile. */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  clientBuildProcessEnvironment,
  resolvePartialClientBuildEnvironment,
} from './client-build-environment.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'

/** Run tsdown with the explicit or last completely built client profile. */
function main(): void {
  const root = resolve(import.meta.dirname, '..')
  const clientEnvironment = resolvePartialClientBuildEnvironment(root, process.env)
  const environment = clientBuildProcessEnvironment(process.env, clientEnvironment)
  // Keep the dotted option and its value in one argv element. tsdown otherwise
  // also treats the separate `client` token as an explicit entry module when
  // invoked through pnpm's JavaScript entrypoint.
  const invocation = pnpmInvocation(['exec', 'tsdown', '--config-loader', 'native', '--env.DSH_BUILD_FACE=client'], environment)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    env: environment,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`client library build exited with ${String(result.status ?? result.signal)}`)
  }
}

if (import.meta.main) main()
