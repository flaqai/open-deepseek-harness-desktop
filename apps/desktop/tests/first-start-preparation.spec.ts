import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { FirstStartPreparation } from '../src/first-start-preparation.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function home() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-first-start-'))
  roots.push(root)
  return root
}

it('retains the gate across interruption after Profile initialization until committed', async () => {
  const root = await home()
  expect(await new FirstStartPreparation(root).begin(true)).toBe(true)
  await mkdir(join(root, 'profiles', 'web'), { recursive: true })
  await writeFile(join(root, 'profiles', 'web', 'package.json'), '{}')
  const restarted = new FirstStartPreparation(root)
  expect(await restarted.begin(false)).toBe(true)
  await restarted.complete()
  expect(await new FirstStartPreparation(root).begin(false)).toBe(false)
})

it('does not enroll existing or reused Profiles into mandatory first-start installation', async () => {
  expect(await new FirstStartPreparation(await home()).begin(false)).toBe(false)
})

it('treats an empty or interrupted marker as pending, not as successful completion', async () => {
  const root = await home()
  const gate = new FirstStartPreparation(root)
  await gate.begin(true)
  await writeFile(join(root, 'bundled-plugins', 'first-start.pending'), 'interrupted')
  expect(await new FirstStartPreparation(root).begin(false)).toBe(true)
})
