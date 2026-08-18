// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CHAT_BACKGROUND_PRESETS, readChatBackground, writeChatBackground,
} from '../src/chat-background.ts'

beforeEach(() => { localStorage.clear() })

describe('chat background persistence', () => {
  it('defaults to no artwork and round-trips a shipped selection', () => {
    expect(readChatBackground()).toEqual({ id: 'none' })
    writeChatBackground(CHAT_BACKGROUND_PRESETS['moon-whale'])
    expect(readChatBackground()).toEqual({
      id: 'moon-whale',
      url: '/theme-backgrounds/moon-whale.webp',
    })
  })

  it('accepts bounded WebP custom data and rejects malformed stored input', () => {
    writeChatBackground({ id: 'custom', url: 'data:image/webp;base64,AAAA' })
    expect(readChatBackground()).toEqual({ id: 'custom', url: 'data:image/webp;base64,AAAA' })
    localStorage.setItem('dsh.theme.chat-background', JSON.stringify({ id: 'custom', url: 'https://example.com/image.png' }))
    expect(readChatBackground()).toEqual({ id: 'none' })
    localStorage.setItem('dsh.theme.chat-background', '{broken')
    expect(readChatBackground()).toEqual({ id: 'none' })
  })

  it('round-trips the shipped inspiration collage with its subject-safe layout', () => {
    writeChatBackground(CHAT_BACKGROUND_PRESETS['idea-collage'])
    expect(readChatBackground()).toEqual({
      id: 'idea-collage',
      url: '/theme-backgrounds/idea-collage.webp',
      layout: 'focus-right',
    })
  })
})
