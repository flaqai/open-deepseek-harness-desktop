/** Download the public alpha.2 installer pinned by its verified GitHub asset digest. */
import { createHash } from 'node:crypto'
import { mkdir, open, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** GitHub release asset metadata verified on 2026-10-20; replacement assets fail closed. */
export const WINDOWS_UPGRADE_BASELINE = Object.freeze({
  url: 'https://github.com/flaqai/open-deepseek-harness-desktop/releases/download/odsh-v0.2.1-alpha.2/DeepSeek-Harness-windows-x64.exe',
  size: 455433576,
  sha256: 'cefd5602187d36d6360a48b2560014cc5a01e61857f07954d5737b59702411e0',
})

/** Write a new file only after enforcing the expected byte count and SHA-256 digest.
 * @param {{url: string, size: number, sha256: string}} asset Expected public asset metadata.
 * @param {string} destination Owned new file path; an existing file is never overwritten.
 * @param {{fetch?: typeof globalThis.fetch}} options Optional download adapter; absent uses the native HTTPS fetch.
 * @returns {Promise<void>} Resolves only for an exact verified asset.
 */
export async function downloadVerifiedAsset(asset, destination, options = {}) {
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || !/^[a-f0-9]{64}$/u.test(asset.sha256)) {
    throw new Error('Invalid expected Windows baseline asset metadata.')
  }
  await mkdir(dirname(destination), { recursive: true })
  const file = await open(destination, 'wx')
  let verified = false
  try {
    const response = await (options.fetch ?? fetch)(asset.url, { signal: AbortSignal.timeout(600_000) })
    if (!response.ok || !response.body) {
      if (response.body) await response.body.cancel()
      throw new Error(`Windows baseline download failed: HTTP ${response.status}.`)
    }
    const hash = createHash('sha256')
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.byteLength
      if (size > asset.size) throw new Error('Windows baseline exceeds its expected asset size.')
      hash.update(chunk)
      await file.writeFile(chunk)
    }
    if (size !== asset.size || hash.digest('hex') !== asset.sha256) {
      throw new Error('Windows baseline size or SHA-256 does not match the pinned public alpha.2 asset.')
    }
    verified = true
  } finally {
    await file.close()
    if (!verified) await rm(destination)
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) throw new Error('usage: download-windows-upgrade-baseline.mjs <new-installer-path>')
  await downloadVerifiedAsset(WINDOWS_UPGRADE_BASELINE, resolve(process.argv[2]))
  console.log(`Verified public alpha.2 Windows baseline: sha256:${WINDOWS_UPGRADE_BASELINE.sha256}`)
}
