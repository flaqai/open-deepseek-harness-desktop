import { useEffect, useMemo, useState } from 'react'
import { fileMediaUrl, isAbsoluteWorkspacePath, pathPartsOf, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssistantBlock } from '../contract/snapshot.ts'
import css from './AssistantMarkdown.module.css'

const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|gif|svg)$/i
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
const RETRY_DELAYS_MS = [0, 250, 750] as const

/** One Assistant-authored local image after workspace-relative resolution. */
export interface LocalPathImage {
  readonly path: string
  readonly url: string
}

/**
 * Map one authored path to the authenticated same-origin file API.
 * @param protocol - current page protocol.
 * @param origin - current page origin.
 * @param value - Assistant-authored absolute or workspace-relative path.
 * @param cwd - Session workspace root used for relative paths.
 * @returns a display URL only when the Host can receive an absolute path.
 */
export function localPathMediaUrl(first: string, second: string, third?: string, cwd?: string, base?: string): string | undefined {
  const documentBase = third === undefined ? first : base ?? second
  const value = third === undefined ? second : third
  if (third !== undefined && first !== 'http:' && first !== 'https:') return undefined
  if (value.length === 0 || value.startsWith('//') || value.startsWith('\\\\')) return undefined
  let decoded: string
  try { decoded = decodeURIComponent(value.split(/[?#]/u)[0] ?? '') }
  catch { return undefined }
  const path = resolveWorkspacePath(cwd, decoded)
  if (!isAbsoluteWorkspacePath(path)) return undefined
  return fileMediaUrl(documentBase, path)
}

/** Remove fenced examples before scanning Assistant prose for real paths. */
function proseWithoutFences(text: string): string {
  let fence: { marker: '`' | '~'; length: number } | undefined
  return text.split('\n').map((line) => {
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fence === undefined) {
      if (opening === null) return line
      const run = opening[1] ?? ''
      fence = { marker: run[0] as '`' | '~', length: run.length }
      return ''
    }
    const closing = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/)
    if (closing !== null) {
      const run = closing[1] ?? ''
      if (run[0] === fence.marker && run.length >= fence.length) fence = undefined
    }
    return ''
  }).join('\n')
}

/** Return the path prefix through a supported extension, without a Markdown title. */
function imagePathPrefix(value: string): string | undefined {
  const unwrapped = value.trim().replace(/^<|>$/g, '').replace(/^`|`$/g, '')
  const match = unwrapped.match(/^(.*?\.(?:png|jpe?g|webp|gif|svg))(?:\s+["'][^\n]*["'])?$/i)
  const path = match?.[1]?.trim()
  if (path === undefined || path === '' || !IMAGE_EXTENSION.test(path)) return undefined
  if (/^(?:https?|data|blob|file):/i.test(path) || path.startsWith('//') || path.startsWith('\\\\')) return undefined
  return path.replace(/[.,;:!?]+$/, '')
}

/**
 * Collect explicit image paths from settled Assistant prose. Markdown images
 * are masked because MarkdownText already renders them at their authored
 * position; links, inline-code file references, and plain paths become the
 * end-of-message gallery. Fenced examples remain inert.
 * @param blocks - Assistant content blocks.
 * @param cwd - Session workspace root for relative paths.
 * @param protocol - current page protocol.
 * @param origin - current page origin.
 * @returns de-duplicated Host-facing paths and URLs in authored order.
 */
export function collectLocalPathImages(
  blocks: readonly AssistantBlock[],
  cwd: string | undefined,
  protocol: string,
  origin: string,
  base?: string,
): readonly LocalPathImage[] {
  const found: LocalPathImage[] = []
  const seen = new Set<string>()
  const add = (authored: string): void => {
    const candidate = imagePathPrefix(authored)
    if (candidate === undefined) return
    const path = resolveWorkspacePath(cwd, candidate)
    if (seen.has(path)) return
    const url = localPathMediaUrl(protocol, origin, candidate, cwd, base)
    if (url === undefined) return
    seen.add(path)
    found.push({ path, url })
  }

  for (const block of blocks) {
    if (block.kind !== 'text') continue
    const prose = proseWithoutFences(block.text)
      // Local Markdown images already render through MarkdownText. Mask them
      // before the generic path scan so the message never shows a duplicate.
      .replace(/!\[[^\]\n]*]\(\s*(?:<[^>\n]+>|[^)\n]+)\s*\)/g, ' ')
      .replace(/!\[[^\]\n]*]\[[^\]\n]*]/g, ' ')

    for (const match of prose.matchAll(/(?<!!)\[[^\]\n]*]\(\s*(?:<([^>\n]+)>|([^)\n]+))\s*\)/g)) {
      add(match[1] ?? match[2] ?? '')
    }
    for (const match of prose.matchAll(/`([^`\n]+\.(?:png|jpe?g|webp|gif|svg))`/gi)) add(match[1] ?? '')

    const withoutLinksAndCode = prose
      .replace(/(?<!!)\[[^\]\n]*]\(\s*(?:<[^>\n]+>|[^)\n]+)\s*\)/g, ' ')
      .replace(/`[^`\n]*`/g, ' ')
    for (const match of withoutLinksAndCode.matchAll(
      /(?:^|[\s("'=])((?:[A-Z]:(?:\/|\\)|\.{0,2}\/)[^\t\r\n<>"'`|?*]*?\.(?:png|jpe?g|webp|gif|svg))/gim,
    )) add(match[1] ?? '')
    for (const match of withoutLinksAndCode.matchAll(
      /(?:^|[\s("'=])(([\p{L}\p{N}_.-]+[\\/])+[\p{L}\p{N}_. -]+\.(?:png|jpe?g|webp|gif|svg))/gimu,
    )) add(match[1] ?? '')
    for (const match of withoutLinksAndCode.matchAll(
      /(?:^|[\s("'=])([\p{L}\p{N}_.-]+\.(?:png|jpe?g|webp|gif|svg))(?=$|[\s)\],.;!?])/gimu,
    )) add(match[1] ?? '')
  }
  return found
}

type ImageStatus = 'checking' | 'ready' | 'failed'

function wait(delay: number, signal: AbortSignal): Promise<void> {
  if (delay === 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, delay)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

async function imageIsReadable(image: LocalPathImage, signal: AbortSignal): Promise<boolean> {
  for (const delay of RETRY_DELAYS_MS) {
    await wait(delay, signal)
    try {
      const response = await fetch(image.url, { method: 'HEAD', signal })
      const mime = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (response.ok && mime !== undefined && IMAGE_MIME.has(mime)) return true
      if (response.status !== 404) return false
    } catch (error: unknown) {
      if (signal.aborted) throw error
    }
  }
  return false
}

/** Settled Assistant local-path gallery with bounded validation and retry. */
export function LocalPathImages({
  images, renderSlot, loadImage, openFile, revealFile, t,
}: {
  images: readonly LocalPathImage[]
  renderSlot: PropsRenderSlots<'conversation.chat.message.images'>['renderSlot']
  loadImage: ChatNodeOwnerProps['loadImage']
  openFile: ChatNodeOwnerProps['openFile']
  revealFile?: ChatNodeOwnerProps['revealFile']
  t: ChatViewSlotProps['t']
}) {
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<ReadonlyMap<string, ImageStatus>>(
    () => new Map(images.map(image => [image.path, 'checking'] as const)),
  )

  useEffect(() => {
    const controller = new AbortController()
    setStatus(new Map(images.map(image => [image.path, 'checking'] as const)))
    for (const image of images) {
      void imageIsReadable(image, controller.signal).then((ready) => {
        if (controller.signal.aborted) return
        setStatus((current) => {
          const next = new Map(current)
          next.set(image.path, ready ? 'ready' : 'failed')
          return next
        })
      }).catch(() => {})
    }
    return () => { controller.abort() }
  }, [attempt, images])

  const ready = useMemo(() => images.filter(image => status.get(image.path) === 'ready'), [images, status])
  const checking = images.some(image => status.get(image.path) === 'checking')
  const failed = images.filter(image => status.get(image.path) === 'failed').length
  if (images.length === 0) return null
  return (
    <div className={css.localImages}>
      {ready.length > 0 && renderSlot('conversation.chat.message.images', {
        loadImage,
        images: ready.map(image => ({
          preview: {
            url: image.url,
            name: pathPartsOf(image.path).name,
            actions: [
              { label: t('localImage.open'), onSelect: () => { openFile(image.path) } },
              ...(revealFile === undefined ? [] : [{
                label: t('localImage.reveal'),
                onSelect: () => { revealFile(image.path) },
              }]),
            ],
          },
        })),
        align: 'start',
        expanded: true,
      })}
      {checking && <div className={css.localImageStatus} role="status">{t('localImage.checking')}</div>}
      {!checking && failed > 0 && (
        <button type="button" className={css.localImageRetry} onClick={() => { setAttempt(value => value + 1) }}>
          {t('localImage.unavailable', { count: failed })}
        </button>
      )}
    </div>
  )
}
