import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { DESKTOP_PRODUCT_NAME } from '../src/product-name.ts'

interface BuilderIdentity {
  appId?: string
  productName?: string
  linux?: { executableName?: string }
  deb?: { packageName?: string }
  rpm?: { packageName?: string }
  mac?: { extendInfo?: { CFBundleDisplayName?: string } }
}

const readBuilder = (name: string): BuilderIdentity => parse(readFileSync(resolve(import.meta.dirname, `../${name}`), 'utf8')) as BuilderIdentity

describe('desktop product identity', () => {
  it.each(['electron-builder.yml', 'electron-builder.macos.yml', 'electron-builder.linux.yml'])('uses the canonical display name in %s', (name) => {
    const config = readBuilder(name)
    expect(config.productName).toBe(DESKTOP_PRODUCT_NAME)
    expect(config.appId).toBe('ai.flaq.deepseek-harness')
  })

  it('uses a matching Linux executable while preserving the upgrade package identity', () => {
    const config = readBuilder('electron-builder.linux.yml')
    expect(config.linux?.executableName).toBe('open-deepseek-harness-desktop')
    expect(config.deb?.packageName).toBe('deepseek-harness')
    expect(config.rpm?.packageName).toBe('deepseek-harness')
  })

  it('uses the canonical macOS bundle display name', () => {
    expect(readBuilder('electron-builder.macos.yml').mac?.extendInfo?.CFBundleDisplayName).toBe(DESKTOP_PRODUCT_NAME)
  })

  it('keeps the macOS source launcher recognizable as Electron while setting the runtime title', () => {
    const launcher = readFileSync(resolve(import.meta.dirname, '../scripts/development-electron.mjs'), 'utf8')
    const main = readFileSync(resolve(import.meta.dirname, '../src/main.ts'), 'utf8')
    expect(launcher).toContain("return join(target, 'Contents', 'MacOS', 'Electron')")
    expect(launcher).not.toContain("renameSync(join(bundle, 'Contents', 'MacOS', 'Electron')")
    expect(main).toContain('process.title = DESKTOP_PRODUCT_NAME')
  })
})
