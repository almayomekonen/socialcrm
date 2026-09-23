/**
 * Outbound media and sender actions: what may be sent, and exactly what reaches
 * Meta on the wire.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ATTACHMENT_REJECTION_COPY,
  checkMessengerAttachment,
  MESSENGER_ATTACHMENT_MAX_BYTES,
  messengerAssetType,
} from '@/lib/facebook/messenger/attachmentRules'
import { sendMessengerAttachment } from '@/lib/facebook/messenger/sendAttachment'
import { sendMessengerSenderAction } from '@/lib/facebook/messenger/senderAction'

afterEach(() => vi.unstubAllEnvs())

const file = (over: Partial<{ size: number; type: string; name: string }> = {}) => ({
  size: 1024,
  type: 'image/png',
  name: 'photo.png',
  ...over,
})

describe('what may be attached', () => {
  it('maps MIME to Meta asset type, and anything unrecognised is a generic file', () => {
    expect(messengerAssetType('image/jpeg')).toBe('image')
    expect(messengerAssetType('video/mp4')).toBe('video')
    expect(messengerAssetType('audio/mpeg')).toBe('audio')
    expect(messengerAssetType('application/pdf')).toBe('file')
    expect(messengerAssetType('')).toBe('file')
  })

  it('ignores parameters on the MIME type rather than failing to classify', () => {
    expect(messengerAssetType('image/jpeg; charset=binary')).toBe('image')
    expect(messengerAssetType('IMAGE/PNG')).toBe('image')
  })

  it('the type comes from the MIME, never from the extension', () => {
    // A .txt name with an image MIME is still an image; the extension is not a fact.
    expect(checkMessengerAttachment(file({ name: 'notes.txt', type: 'image/png' }))).toEqual({ type: 'image' })
  })

  it('refuses an empty file, and one over Meta\'s 25MB limit', () => {
    expect(checkMessengerAttachment(file({ size: 0 }))).toEqual({ reason: 'empty' })
    expect(checkMessengerAttachment(file({ size: MESSENGER_ATTACHMENT_MAX_BYTES + 1 }))).toEqual({ reason: 'too_large' })
    // Exactly at the limit is allowed — the rejection is strictly above it.
    expect(checkMessengerAttachment(file({ size: MESSENGER_ATTACHMENT_MAX_BYTES }))).toEqual({ type: 'image' })
  })

  it('refuses executables and scripts by MIME AND by extension', () => {
    expect(checkMessengerAttachment(file({ name: 'setup.exe', type: 'application/octet-stream' }))).toEqual({
      reason: 'blocked_type',
    })
    expect(checkMessengerAttachment(file({ name: 'payload.sh', type: 'text/plain' }))).toEqual({ reason: 'blocked_type' })
    expect(checkMessengerAttachment(file({ name: 'x.PHP', type: 'text/plain' }))).toEqual({ reason: 'blocked_type' })
    expect(checkMessengerAttachment(file({ name: 'safe.pdf', type: 'application/x-msdownload' }))).toEqual({
      reason: 'blocked_type',
    })
  })

  it('every rejection has copy that names the limit', () => {
    expect(ATTACHMENT_REJECTION_COPY.too_large).toContain('25MB')
    for (const reason of ['empty', 'too_large', 'blocked_type'] as const) {
      expect(ATTACHMENT_REJECTION_COPY[reason].length).toBeGreaterThan(0)
    }
  })
})

/** Captures the single fetch the sender makes. */
function captureFetch(response: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init })
    return { ok: status < 400, status, json: async () => response } as unknown as Response
  })
  return { calls, impl: impl as unknown as typeof fetch }
}

describe('sending an attachment', () => {
  const base = {
    pageId: 'PAGE1',
    pageAccessToken: 'TOKEN-SECRET',
    psid: 'PSID1',
    type: 'image' as const,
    file: new Blob(['x'], { type: 'image/png' }),
    filename: 'photo.png',
  }

  it('posts multipart form data with recipient, messaging_type and filedata', async () => {
    const { calls, impl } = captureFetch({ message_id: 'mid.1' })
    const result = await sendMessengerAttachment({ ...base, fetchImpl: impl })

    expect(result).toEqual({ ok: true, mid: 'mid.1' })
    const body = calls[0].init.body as FormData
    expect(JSON.parse(body.get('recipient') as string)).toEqual({ id: 'PSID1' })
    expect(body.get('messaging_type')).toBe('RESPONSE')
    expect(JSON.parse(body.get('message') as string)).toEqual({
      attachment: { type: 'image', payload: { is_reusable: false } },
    })
    expect(body.get('filedata')).toBeInstanceOf(Blob)
  })

  it('never puts the token in the URL — it travels in the Authorization header', async () => {
    const { calls, impl } = captureFetch({ message_id: 'mid.1' })
    await sendMessengerAttachment({ ...base, fetchImpl: impl })

    expect(calls[0].url).not.toContain('TOKEN-SECRET')
    expect(calls[0].url).not.toMatch(/access_token/i)
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN-SECRET')
  })

  it('binds the call to this app with appsecret_proof when an app secret is configured', async () => {
    vi.stubEnv('META_APP_SECRET', 'app-secret')
    const { calls, impl } = captureFetch({ message_id: 'mid.1' })
    await sendMessengerAttachment({ ...base, fetchImpl: impl })
    expect(calls[0].url).toContain('appsecret_proof=')
    // The proof is an HMAC of the token, never the token or the secret itself.
    expect(calls[0].url).not.toContain('app-secret')
    expect(calls[0].url).not.toContain('TOKEN-SECRET')
  })

  it('does not set Content-Type itself — fetch must choose the multipart boundary', async () => {
    const { calls, impl } = captureFetch({ message_id: 'mid.1' })
    await sendMessengerAttachment({ ...base, fetchImpl: impl })
    const headers = calls[0].init.headers as Record<string, string>
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('content-type')
  })

  it('strips path separators and control characters from the filename', async () => {
    const { calls, impl } = captureFetch({ message_id: 'mid.1' })
    await sendMessengerAttachment({ ...base, filename: '../../etc/pa"ss\nwd.png', fetchImpl: impl })
    const name = (calls[0].init.body as FormData).get('filedata') as File
    expect(name.name).not.toContain('/')
    expect(name.name).not.toContain('"')
    expect(name.name).not.toContain('\n')
  })

  it('a Meta error is returned as a typed failure, never thrown', async () => {
    const { impl } = captureFetch({ error: { code: 10, error_subcode: 2018278, message: 'outside window' } }, 400)
    const result = await sendMessengerAttachment({ ...base, fetchImpl: impl })
    expect(result).toMatchObject({ ok: false, error: { kind: 'graph', code: 10, subcode: 2018278 } })
  })

  it('a 200 with no message_id is an invalid response, not a success', async () => {
    const { impl } = captureFetch({ recipient_id: 'PSID1' })
    const result = await sendMessengerAttachment({ ...base, fetchImpl: impl })
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid_response' } })
  })

  it('a network failure is a typed failure, never thrown', async () => {
    const impl = vi.fn(async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch
    const result = await sendMessengerAttachment({ ...base, fetchImpl: impl })
    expect(result).toMatchObject({ ok: false, error: { kind: 'network', status: 0 } })
  })
})

describe('sender actions', () => {
  it('sends ONLY recipient and sender_action — Meta rejects the call otherwise', async () => {
    const { calls, impl } = captureFetch({ recipient_id: 'PSID1' })
    const result = await sendMessengerSenderAction({
      pageId: 'PAGE1',
      pageAccessToken: 'T',
      psid: 'PSID1',
      action: 'typing_on',
      fetchImpl: impl,
    })

    expect(result).toEqual({ ok: true })
    const body = JSON.parse(calls[0].init.body as string)
    expect(body).toEqual({ recipient: { id: 'PSID1' }, sender_action: 'typing_on' })
    expect(body).not.toHaveProperty('message')
    expect(body).not.toHaveProperty('messaging_type')
  })

  it('a refusal is reported, not thrown — a typing dot must never break a reply', async () => {
    const { impl } = captureFetch({ error: { code: 100 } }, 400)
    const result = await sendMessengerSenderAction({
      pageId: 'PAGE1',
      pageAccessToken: 'T',
      psid: 'PSID1',
      action: 'typing_off',
      fetchImpl: impl,
    })
    expect(result).toMatchObject({ ok: false })
  })
})
