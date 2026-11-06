import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { verifyPreinstalledComputerUse } from '../scripts/preinstalled-browser-providers.mjs'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const targets = {
  'darwin-arm64': ['darwin-arm64', 'libcua_driver_sdk.dylib'],
  'darwin-x64': ['darwin-x64', 'libcua_driver_sdk.dylib'],
  'win32-x64': ['win32-x64-msvc', 'cua_driver_sdk.dll'],
  'linux-x64': ['linux-x64-gnu', 'libcua_driver_sdk.so'],
} as const
function fixture(target: keyof typeof targets) {
  const root = mkdtempSync(join(tmpdir(), 'computer offline ')); roots.push(root)
  const [suffix, library] = targets[target]
  const nativeName = `@trycua/cua-driver-${suffix}`
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.2.2-alpha.3' }))
  const packages = [
    ['@deepseek-ai/dsh-computer-use', '0.2.2-alpha.3', {}],
    ['@deepseek-ai/dsh-experimental-computer-use-cua-driver-native', '0.2.2-alpha.3',
      { dependencies: { '@trycua/cua-driver': '0.28.0' } }],
    ['@trycua/cua-driver', '0.28.0', { dependencies: { '@ubjs/node': '0.31.0-3', '@ubjs/core': '0.31.0-3' }, optionalDependencies: { [nativeName]: '0.28.0', '@trycua/cua-driver-foreign': '0.28.0' } }],
    [nativeName, '0.28.0', {}], ['@ubjs/node', '0.31.0-3', {}], ['@ubjs/core', '0.31.0-3', {}],
  ] as const
  for (const [name, version, extra] of packages) {
    const directory = join(root, 'node_modules', name)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version, ...extra }))
  }
  for (const path of [
    '@trycua/cua-driver/dist/native/node-runtime.js', '@trycua/cua-driver/dist/native/cua_driver_sdk-ffi.js',
    '@ubjs/node/typescript/dist/resolve-lib.js', `${nativeName}/${library}`,
    `${nativeName}/cua_driver_node_runtime.node`, `${nativeName}/node-runtime-NOTICE.md`,
  ]) {
    const file = join(root, 'node_modules', path)
    mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, 'fixture')
  }
  return { root, nativeName }
}
it.each(Object.keys(targets) as Array<keyof typeof targets>)('verifies %s native resources without importing SDK code', (target) => {
  const { root } = fixture(target)
  expect(() => { verifyPreinstalledComputerUse(root, target) }).not.toThrow()
})
it('rejects an SDK missing the native Node addon', () => {
  const { root, nativeName } = fixture('darwin-arm64')
  rmSync(join(root, 'node_modules', nativeName, 'cua_driver_node_runtime.node'))
  expect(() => { verifyPreinstalledComputerUse(root, 'darwin-arm64') }).toThrow('missing SDK loader or native resource')
})
it('rejects a missing loader dependency and a retained foreign native package', () => {
  const { root } = fixture('win32-x64')
  rmSync(join(root, 'node_modules/@ubjs/node'), { recursive: true })
  expect(() => { verifyPreinstalledComputerUse(root, 'win32-x64') }).toThrow('missing offline dependency')
  const other = fixture('linux-x64')
  const foreign = join(other.root, 'node_modules/@trycua/cua-driver-foreign')
  mkdirSync(foreign, { recursive: true }); writeFileSync(join(foreign, 'package.json'), '{}')
  expect(() => { verifyPreinstalledComputerUse(other.root, 'linux-x64') }).toThrow('foreign native CUA package')
})
