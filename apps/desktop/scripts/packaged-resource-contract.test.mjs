import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'
import { verifyBundledSpellcheckDictionaries } from './spellcheck-dictionaries.mjs'

const root = resolve(import.meta.dirname, '../../..')
const contractPath = join(import.meta.dirname, 'packaged-resource-contract.json')
const contract = JSON.parse(await readFile(contractPath, 'utf8'))

function resourcesFor(candidate, platform) {
  const selected = candidate.platforms[platform]
  return [...(selected.prependResources ?? []), ...candidate.commonResources, ...selected.resources]
}

function assertBuilderConfig(platform, config, candidate = contract) {
  assert.deepEqual(config.files, candidate.asarFiles, `${platform} asar files diverged from the contract`)
  assert.deepEqual(config.extraResources, resourcesFor(candidate, platform),
    `${platform} packaged resource mappings diverged from the contract`)
}

test('every desktop builder config satisfies the packaged resource contract', async () => {
  assert.equal(contract.schema, 'open-deepseek-harness-desktop/packaged-resource-contract/v1')
  for (const source of contract.staticSourceFiles) await access(join(root, source))

  for (const [platform, platformContract] of Object.entries(contract.platforms)) {
    const config = parse(await readFile(join(root, platformContract.config), 'utf8'))
    assertBuilderConfig(platform, config)
  }
})

test('the contract is colocated with its static source roots', () => {
  assert.equal(dirname(contractPath), join(root, 'apps/desktop/scripts'))
})

function assertOfficeResourceLayout(candidate) {
  for (const platform of ['macos', 'linux']) {
    const destinations = resourcesFor(candidate, platform).map(resource => resource.to)
    assert.ok(destinations.includes('harness-runtime.tar'), `${platform} needs an archive for versioned extraction`)
    assert.ok(!destinations.includes('harness/node_modules'), `${platform} must use the extracted runtime`)
  }
  const windowsDestinations = resourcesFor(candidate, 'windows').map(resource => resource.to)
  assert.ok(windowsDestinations.includes('harness/node_modules'), 'Windows needs expanded Office modules')
  assert.ok(!windowsDestinations.includes('harness-runtime.tar'), 'Windows does not extract a Harness archive')
}

test('Unix archives and Windows expanded resources match the packaged Office lookup', () => {
  assertOfficeResourceLayout(contract)
})

test('the Office layout guard rejects a Unix package that reintroduces expanded modules', () => {
  const invalid = structuredClone(contract)
  invalid.platforms.linux.resources.push({ from: 'fixture', to: 'harness/node_modules' })
  assert.throws(() => assertOfficeResourceLayout(invalid), /linux must use the extracted runtime/u)
})

const dictionaryResource = {
  from: 'assets/spellcheck-dictionaries', to: 'spellcheck-dictionaries', filter: ['**/*'],
}

function assertSpellcheckResourceLayout(candidate) {
  for (const platform of ['windows', 'linux']) {
    assert.deepEqual(resourcesFor(candidate, platform)[0], dictionaryResource,
      `${platform} needs the complete offline dictionaries and notices before shared resources`)
  }
  assert.ok(resourcesFor(candidate, 'macos').every(resource =>
    resource.from !== dictionaryResource.from && resource.to !== dictionaryResource.to),
    'macOS uses system spelling and must not carry offline dictionaries')
}

test('Windows and Linux retain reviewed dictionary and notice assets while macOS uses system spelling', async () => {
  assertSpellcheckResourceLayout(contract)
  await verifyBundledSpellcheckDictionaries()
})

for (const platform of ['windows', 'linux']) {
  test(`${platform} rejects a builder that omits offline dictionary resources`, async () => {
    const config = parse(await readFile(join(root, contract.platforms[platform].config), 'utf8'))
    config.extraResources = config.extraResources.filter(resource => resource.to !== dictionaryResource.to)
    assert.throws(() => assertBuilderConfig(platform, config), /packaged resource mappings diverged/u)
  })

  test(`${platform} rejects a contract that drops dictionary or notice coverage`, () => {
    const missing = structuredClone(contract)
    missing.platforms[platform].prependResources = []
    assert.throws(() => assertSpellcheckResourceLayout(missing), /needs the complete offline dictionaries/u)
    const filtered = structuredClone(contract)
    filtered.platforms[platform].prependResources[0].filter = ['*.bdic']
    assert.throws(() => assertSpellcheckResourceLayout(filtered), /needs the complete offline dictionaries/u)
  })
}

test('macOS rejects accidentally inherited offline dictionary resources', () => {
  const invalid = structuredClone(contract)
  invalid.platforms.macos.prependResources = [dictionaryResource]
  assert.throws(() => assertSpellcheckResourceLayout(invalid), /macOS uses system spelling/u)
})
