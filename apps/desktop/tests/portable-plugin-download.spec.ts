import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import { downloadPortablePluginArchive } from '../src/portable-plugin-download.ts'

const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(tamper = false): Promise<{ registry: string; archive: Buffer }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-portable-registry-'))
  roots.push(root)
  await mkdir(join(root, 'package'))
  await writeFile(join(root, 'package', 'package.json'), JSON.stringify({ name: 'example-plugin', version: '1.2.3' }))
  const archivePath = join(root, 'example-plugin.tgz')
  await create({ cwd: root, file: archivePath, gzip: true }, ['package'])
  const archive = await readFile(archivePath)
  const server = createServer((request, response) => {
    if (request.url === '/example-plugin/1.2.3') {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('server is not listening')
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({
        name: 'example-plugin', version: '1.2.3',
        dist: {
          tarball: `http://127.0.0.1:${address.port}/example-plugin/-/example-plugin-1.2.3.tgz`,
          integrity: `sha512-${createHash('sha512').update(tamper ? Buffer.from('wrong') : archive).digest('base64')}`,
        },
      }))
    } else if (request.url === '/example-plugin/-/example-plugin-1.2.3.tgz') {
      response.end(archive)
    } else {
      response.statusCode = 404
      response.end()
    }
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server is not listening')
  return { registry: `http://127.0.0.1:${address.port}`, archive }
}

describe('portable plugin registry download', () => {
  it('downloads an exact original archive with registry SHA-512 verification', async () => {
    const { registry, archive } = await fixture()
    const downloaded = await downloadPortablePluginArchive(registry, 'example-plugin', '1.2.3')
    expect(await readFile(downloaded.archive)).toEqual(archive)
    await downloaded.cleanup()
    await expect(readFile(downloaded.archive)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a registry response with mismatched integrity', async () => {
    const { registry } = await fixture(true)
    await expect(downloadPortablePluginArchive(registry, 'example-plugin', '1.2.3'))
      .rejects.toThrow('integrity check')
  })

  it('rejects invalid identities before any request', async () => {
    await expect(downloadPortablePluginArchive('http://127.0.0.1:9', '../escape', '1.2.3'))
      .rejects.toThrow('invalid portable plugin')
  })

  it('accepts the reviewed npmmirror CDN redirect but rejects other cross-origin redirects', async () => {
    const { archive } = await fixture()
    const request = async (url: URL): Promise<Response> => {
      if (url.pathname.endsWith('/1.2.3')) return Response.json({
        name: 'example-plugin', version: '1.2.3', dist: {
          tarball: 'https://registry.npmmirror.com/example-plugin/-/example-plugin-1.2.3.tgz',
          integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
        },
      })
      if (url.hostname === 'registry.npmmirror.com') {
        return Response.redirect('https://cdn.npmmirror.com/packages/example-plugin-1.2.3.tgz', 302)
      }
      return new Response(new Uint8Array(archive))
    }
    const downloaded = await downloadPortablePluginArchive(
      'https://registry.npmmirror.com', 'example-plugin', '1.2.3', request,
    )
    expect(await readFile(downloaded.archive)).toEqual(archive)
    await downloaded.cleanup()
    await expect(downloadPortablePluginArchive(
      'https://registry.npmjs.org', 'example-plugin', '1.2.3', request,
    )).rejects.toThrow(/selected registry/u)
  })
})
