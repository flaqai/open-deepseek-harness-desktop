import assert from 'node:assert/strict'
import { test } from 'node:test'
import { electronDownloadEnvironment } from './electron-download-network.mjs'

const settings = ' HTTPEnable : 1\n HTTPProxy : 127.0.0.1\n HTTPPort : 7890\n HTTPSEnable : 1\n HTTPSProxy : 127.0.0.1\n HTTPSPort : 7890\n'
test('adopts enabled macOS HTTP proxies only in the installer child', () => {
  const parent = { CUSTOM: 'retained' }
  assert.deepEqual(electronDownloadEnvironment(parent, 'darwin', () => settings), {
    CUSTOM: 'retained', HTTP_PROXY: 'http://127.0.0.1:7890', HTTPS_PROXY: 'http://127.0.0.1:7890', ELECTRON_GET_USE_PROXY: '1',
  })
  assert.deepEqual(parent, { CUSTOM: 'retained' })
})
test('preserves explicit routes, mirror, checksum and version options on every platform', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const env = { https_proxy: 'http://explicit.test:8080', ELECTRON_MIRROR: 'https://mirror.test/', ELECTRON_INSTALL_ARCH: 'arm64' }
    assert.deepEqual(electronDownloadEnvironment(env, platform, () => { throw Error('must not read system proxy') }), { ...env, ELECTRON_GET_USE_PROXY: '1' })
  }
})
test('does not guess an HTTP route from SOCKS or ALL_PROXY', () => {
  assert.deepEqual(electronDownloadEnvironment({ ALL_PROXY: 'socks5://localhost:7890' }, 'darwin', () => { throw Error('explicit route') }), { ALL_PROXY: 'socks5://localhost:7890' })
})
test('respects explicit download and system proxy opt-outs', () => {
  for (const env of [{ ELECTRON_GET_USE_PROXY: '' }, { ODSH_USE_SYSTEM_PROXY: '0' }]) {
    assert.deepEqual(electronDownloadEnvironment(env, 'darwin', () => { throw Error('opt-out') }), env)
  }
})
test('ignores disabled, malformed or missing system proxy settings', () => {
  for (const value of ['', settings.replaceAll('Enable : 1', 'Enable : 0'), settings.replaceAll('7890', '99999'), settings.replaceAll('127.0.0.1', 'user:password@host')]) {
    assert.deepEqual(electronDownloadEnvironment({}, 'darwin', () => value), {})
  }
})
test('handles IPv6 system proxy hosts and does not query macOS on other platforms', () => {
  assert.equal(electronDownloadEnvironment({}, 'darwin', () => settings.replaceAll('127.0.0.1', '::1')).HTTPS_PROXY, 'http://[::1]:7890')
  assert.deepEqual(electronDownloadEnvironment({}, 'win32', () => { throw Error('not macOS') }), {})
})

test('system discovery opt-out still honors an explicit HTTP proxy', () => {
  assert.equal(electronDownloadEnvironment({ ODSH_USE_SYSTEM_PROXY: '0', HTTPS_PROXY: 'http://explicit.test:8080' }, 'darwin', () => { throw Error('no system read') }).ELECTRON_GET_USE_PROXY, '1')
})
