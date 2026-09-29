import { expect, it } from 'vitest'
import { sessionSelectionPersistKey } from '../src/client/navigation.ts'

it('keeps the floating Session selection separate from main navigation', () => {
  expect(sessionSelectionPersistKey('')).toBe('dsh.sessions.current')
  expect(sessionSelectionPersistKey('?surface=orb')).toBe('dsh.sessions.current.orb')
  expect(sessionSelectionPersistKey('?surface=orb&other=1')).toBe('dsh.sessions.current')
  expect(sessionSelectionPersistKey('?surface=main')).toBe('dsh.sessions.current')
  expect(sessionSelectionPersistKey('?surface=orb&surface=orb')).toBe('dsh.sessions.current')
})
