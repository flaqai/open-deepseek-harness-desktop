// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createEditor } from 'lexical'
import { afterEach, expect, it } from 'vitest'
import { ComposerContentEditable } from '../src/client/input/editor/ComposerContentEditable.tsx'
afterEach(cleanup)
it('enables native spelling on the bound composer without changing editability', () => {
  const editor = createEditor({ onError(error) { throw error } })
  const view = render(<ComposerContentEditable editor={editor} editable />)
  const root = screen.getByRole('textbox')
  expect(root.getAttribute('spellcheck')).toBe('true')
  expect(root.getAttribute('contenteditable')).toBe('true')
  view.rerender(<ComposerContentEditable editor={editor} editable={false} />)
  expect(root.getAttribute('contenteditable')).toBe('false')
})
