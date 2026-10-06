import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendWhatsappTemplate } from '@/lib/whatsapp/sendTemplateMessage'

/**
 * Transport mirror of `sendWhatsappText`: same recipient normalization + envelope,
 * but a `type: 'template'` payload (delivers past the 24h window). fetch is mocked;
 * the Israeli-number fix and the structured failure shape are asserted.
 */

function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response
}

const base = {
  phoneNumberId: 'PN_1',
  accessToken: 'secret-token',
  to: '0537736636', // Israeli local — must be normalized to 972…
  name: 'follow_up',
  language: 'he',
  params: ['דוד', 'סושיאל'],
}

beforeEach(() => vi.restoreAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('sendWhatsappTemplate — payload', () => {
  it('POSTs a template message with normalized recipient, Bearer token, and body params', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(200, { messages: [{ id: 'wamid.X' }] }))
    const out = await sendWhatsappTemplate(base)
    expect(out).toEqual({ ok: true, wamid: 'wamid.X' })

    const [url, init] = spy.mock.calls[0]
    expect(String(url)).toContain('/PN_1/messages')
    const i = init as RequestInit
    expect(i.method).toBe('POST')
    expect((i.headers as Record<string, string>).Authorization).toBe('Bearer secret-token')
    const body = JSON.parse(String(i.body))
    expect(body.type).toBe('template')
    expect(body.to).toBe('972537736636') // 0537736636 → 972…
    expect(body.template.name).toBe('follow_up')
    expect(body.template.language).toEqual({ code: 'he' })
    expect(body.template.components[0].type).toBe('body')
    expect(body.template.components[0].parameters).toEqual([
      { type: 'text', text: 'דוד' },
      { type: 'text', text: 'סושיאל' },
    ])
  })

  it('omits components entirely when there are no params', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(200, { messages: [{ id: 'wamid.Y' }] }))
    await sendWhatsappTemplate({ ...base, params: [] })
    const body = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))
    expect(body.template.components).toBeUndefined()
  })
})

describe('sendWhatsappTemplate — image header', () => {
  const bodyOf = (spy: { mock: { calls: unknown[][] } }) =>
    JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))

  it('without headerImage the payload is identical to before (no header component)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(200, { messages: [{ id: 'wamid.A' }] }))
    await sendWhatsappTemplate(base)
    expect(bodyOf(spy).template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'דוד' }, { type: 'text', text: 'סושיאל' }] },
    ])
  })

  it('a link image becomes a header component, placed before the body', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(200, { messages: [{ id: 'wamid.B' }] }))
    await sendWhatsappTemplate({ ...base, headerImage: { link: 'https://example.com/i.jpg' } })
    expect(bodyOf(spy).template.components).toEqual([
      { type: 'header', parameters: [{ type: 'image', image: { link: 'https://example.com/i.jpg' } }] },
      { type: 'body', parameters: [{ type: 'text', text: 'דוד' }, { type: 'text', text: 'סושיאל' }] },
    ])
  })

  it('an image-header template with a static body sends only the header', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(200, { messages: [{ id: 'wamid.C' }] }))
    const out = await sendWhatsappTemplate({ ...base, params: [], headerImage: { id: 'MEDIA_1' } })
    expect(out).toEqual({ ok: true, wamid: 'wamid.C' })
    expect(bodyOf(spy).template.components).toEqual([
      { type: 'header', parameters: [{ type: 'image', image: { id: 'MEDIA_1' } }] },
    ])
  })
})

describe('sendWhatsappTemplate — failure envelope', () => {
  it('returns a structured failure with the Graph code (never throws)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      res(400, { error: { message: 'bad', code: 132000, error_subcode: 2, fbtrace_id: 'fb1' } }),
    )
    const out = await sendWhatsappTemplate(base)
    expect(out).toMatchObject({ ok: false, code: '132000', httpStatus: 400, subcode: '2', fbtraceId: 'fb1' })
  })

  it('a thrown fetch resolves to a network-error failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'))
    const out = await sendWhatsappTemplate(base)
    expect(out.ok).toBe(false)
    if (out.ok === false) expect(out.error).toContain('boom')
  })

  it('a 200 with no message id is a failure (no fake success)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(200, { messages: [] }))
    const out = await sendWhatsappTemplate(base)
    expect(out).toEqual({ ok: false, error: 'no-message-id', httpStatus: 200 })
  })
})
