/** Browser-local chat background selection and custom-image preparation. */

const STORAGE_KEY = 'dsh.theme.chat-background'
const MAX_SOURCE_BYTES = 12 * 1024 * 1024
const MAX_STORED_CHARACTERS = 3 * 1024 * 1024
const MAX_WIDTH = 1920
const MAX_HEIGHT = 1200

/** Shipped and user-provided chat background identifiers. */
export const CHAT_BACKGROUND_IDS = [
  'none', 'deep-ocean', 'moon-whale', 'bubble-whale',
  'idea-collage', 'anime-starlight', 'pirate-horizon', 'shinobi-ember', 'rift-arena', 'custom',
] as const

/** One chat background accepted by the settings UI and presenter. */
export type ChatBackgroundId = typeof CHAT_BACKGROUND_IDS[number]

/** Artwork placement that reserves low-detail space for the conversation. */
export type ChatBackgroundLayout = 'focus-left' | 'focus-right'

/** Current background projected with every theme snapshot. */
export interface ChatBackground {
  /** Stable selection id. */
  id: ChatBackgroundId
  /** Browser-resolvable image URL; absent for the no-background state. */
  url?: string
  /** Optional subject-safe placement; absent backgrounds use an immersive center crop. */
  layout?: ChatBackgroundLayout
}

/** Built-in original-art background URLs in the default Web application. */
export const CHAT_BACKGROUND_PRESETS: Readonly<Record<Exclude<ChatBackgroundId, 'custom'>, ChatBackground>> = Object.freeze({
  none: Object.freeze({ id: 'none' }),
  'deep-ocean': Object.freeze({ id: 'deep-ocean', url: '/theme-backgrounds/deep-ocean-whale.webp' }),
  'moon-whale': Object.freeze({ id: 'moon-whale', url: '/theme-backgrounds/moon-whale.webp' }),
  'bubble-whale': Object.freeze({ id: 'bubble-whale', url: '/theme-backgrounds/bubble-whale.webp' }),
  'idea-collage': Object.freeze({
    id: 'idea-collage', url: '/theme-backgrounds/idea-collage.webp', layout: 'focus-right',
  }),
  'anime-starlight': Object.freeze({
    id: 'anime-starlight', url: '/theme-backgrounds/anime-starlight.webp', layout: 'focus-right',
  }),
  'pirate-horizon': Object.freeze({
    id: 'pirate-horizon', url: '/theme-backgrounds/pirate-horizon.webp', layout: 'focus-right',
  }),
  'shinobi-ember': Object.freeze({
    id: 'shinobi-ember', url: '/theme-backgrounds/shinobi-ember.webp', layout: 'focus-right',
  }),
  'rift-arena': Object.freeze({
    id: 'rift-arena', url: '/theme-backgrounds/rift-arena.webp', layout: 'focus-right',
  }),
})

/**
 * Read the browser-local selection, rejecting malformed or stale custom data.
 * @returns the stored selection or the no-background preset.
 */
export function readChatBackground(): ChatBackground {
  if (typeof localStorage === 'undefined') return CHAT_BACKGROUND_PRESETS.none
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return CHAT_BACKGROUND_PRESETS.none
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return CHAT_BACKGROUND_PRESETS.none
    const id = (parsed as { id?: unknown }).id
    if (typeof id !== 'string' || !CHAT_BACKGROUND_IDS.some(candidate => candidate === id)) {
      return CHAT_BACKGROUND_PRESETS.none
    }
    const backgroundId = id as ChatBackgroundId
    if (backgroundId !== 'custom') return CHAT_BACKGROUND_PRESETS[backgroundId]
    const url = (parsed as { url?: unknown }).url
    if (typeof url !== 'string' || !url.startsWith('data:image/webp;base64,') || url.length > MAX_STORED_CHARACTERS) {
      return CHAT_BACKGROUND_PRESETS.none
    }
    return { id: backgroundId, url }
  } catch {
    return CHAT_BACKGROUND_PRESETS.none
  }
}

/**
 * Persist one validated background selection on this browser only.
 * @param background - selection published by ThemeRuntime.
 */
export function writeChatBackground(background: ChatBackground): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(background))
}

/**
 * Downscale one user image into a bounded WebP data URL suitable for local persistence.
 * @param file - PNG, JPEG, or WebP source selected through the browser file picker.
 * @returns compressed WebP data URL.
 */
export async function prepareCustomBackground(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('background.unsupported')
  }
  if (file.size > MAX_SOURCE_BYTES) throw new Error('background.tooLarge')
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_WIDTH / bitmap.width, MAX_HEIGHT / bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('background.failed')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result === null) reject(new Error('background.failed'))
        else resolve(result)
      }, 'image/webp', 0.82)
    })
    const url = await blobToDataUrl(blob)
    if (url.length > MAX_STORED_CHARACTERS) throw new Error('background.tooLarge')
    return url
  } finally {
    bitmap.close()
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('background.failed'))
    })
    reader.addEventListener('error', () => { reject(new Error('background.failed')) })
    reader.readAsDataURL(blob)
  })
}
