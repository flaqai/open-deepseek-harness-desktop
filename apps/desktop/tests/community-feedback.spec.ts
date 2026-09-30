import { describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_FEEDBACK_EMAIL, communityFeedbackMailto, parseCommunityFeedbackInput, submitCommunityFeedback,
} from '../src/community-feedback.ts'

const input = {
  kind: 'bug' as const,
  title: 'Update did not start',
  body: 'Checking for updates remained idle after clicking the button.',
  requestId: '123e4567-e89b-42d3-a456-426614174000',
}

describe('community feedback host', () => {
  it('accepts only bounded authored fields', () => {
    expect(parseCommunityFeedbackInput(input, true)).toEqual(input)
    expect(() => parseCommunityFeedbackInput({ ...input, apiKey: 'secret' }, true)).toThrow()
    expect(() => parseCommunityFeedbackInput({ ...input, body: 'short' }, true)).toThrow()
    expect(() => parseCommunityFeedbackInput({ ...input, requestId: 'invalid' }, true)).toThrow()
    expect(() => parseCommunityFeedbackInput({ ...input, replyEmail: 'not an address' }, true)).toThrow()
  })

  it('builds mail only for the published recipient and encodes draft text', () => {
    const href = communityFeedbackMailto(input, '0.2.0-rc.2.1', 'darwin')
    expect(href).toMatch(new RegExp(`^mailto:${COMMUNITY_FEEDBACK_EMAIL.replace('.', '\\.')}\\?`))
    expect(decodeURIComponent(href)).toContain(input.body)
    expect(decodeURIComponent(href)).toContain('Desktop: 0.2.0-rc.2.1')
    const partial = parseCommunityFeedbackInput({ kind: 'bug', title: '短', body: input.body, replyEmail: 'unfinished' }, false)
    expect(decodeURIComponent(communityFeedbackMailto(partial, '0.2.0', 'win32'))).toContain(input.body)
  })

  it('does not claim receipt while disabled, failed, or rate-limited', async () => {
    const fetcher = vi.fn()
    expect(await submitCommunityFeedback(input, '0.2.0', 'darwin', null, fetcher)).toEqual({ status: 'unavailable' })
    expect(fetcher).not.toHaveBeenCalled()
    await expect(submitCommunityFeedback(input, '0.2.0', 'darwin', 'http://example.test/v1/feedback', fetcher)).rejects.toThrow()
    fetcher.mockResolvedValueOnce({ status: 429 }).mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 202, json: async () => ({ id: input.requestId }) })
    const endpoint = 'https://feedback.example.test/v1/feedback'
    expect(await submitCommunityFeedback(input, '0.2.0', 'darwin', endpoint, fetcher)).toEqual({ status: 'rate-limited' })
    expect(await submitCommunityFeedback(input, '0.2.0', 'darwin', endpoint, fetcher)).toEqual({ status: 'failed' })
    expect(await submitCommunityFeedback(input, '0.2.0', 'darwin', endpoint, fetcher)).toEqual({ status: 'received', id: input.requestId })
    const request = fetcher.mock.calls[2]?.[1] as RequestInit
    expect(typeof request.body).toBe('string')
    expect(JSON.parse(request.body as string)).toEqual({ ...input, desktopVersion: '0.2.0', platform: 'darwin' })
  })
})
