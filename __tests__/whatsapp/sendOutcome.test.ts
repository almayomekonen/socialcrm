import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which WhatsApp send outcomes are UNKNOWN (`ambiguous`), for both customer
 * send primitives. Meta is `fetch`; nothing is sent.
 *
 *   Graph error body   → an answer: definite, not ambiguous (safe to retry)
 *   no response        → timeout / reset / dropped connection: ambiguous
 *   non-2xx, no Graph  → a gateway page, not Meta's answer: ambiguous
 *   2xx, no message id → most likely accepted: ambiguous
 *   refused before the request (the opt-out gate) → never ambiguous
 */

vi.mock('@/lib/whatsapp/optOut/sendGate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/optOut/sendGate')>()
  return {
    ...actual,
    // With a consent: straight through (no DB). Without one: the real gate, which refuses before any request.
    runGatedWhatsappSend: vi.fn((consent: unknown, to: string, send: () => Promise<unknown>) =>
      consent ? send() : actual.runGatedWhatsappSend(consent as never, to, send as never),
    ),
  }
})

const { sendWhatsappTemplate } = await import('@/lib/whatsapp/sendTemplateMessage')
const { sendWhatsappText } = await import('@/lib/whatsapp/sendMessage')
const { AUTOMATED_SEND_TIMEOUT_MS } = await import('@/lib/whatsapp/sendOutcome')

const consent = { kind: 'automated' as const, agencyId: 7 }
const template = (over: Record<string, unknown> = {}) =>
  sendWhatsappTemplate({ phoneNumberId: 'pn', accessToken: 't', to: '972501234567', name: 'tpl', language: 'he', params: [], consent, ...over } as never)
const text = (over: Record<string, unknown> = {}) =>
  sendWhatsappText({ phoneNumberId: 'pn', accessToken: 't', to: '972501234567', body: 'שלום', consent, ...over } as never)

let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown, isJson = true) =>
  fetchMock.mockImplementation(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (!isJson) throw new SyntaxError('Unexpected token <')
      return body
    },
    headers: { get: () => null },
  }))

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe.each([
  ['template', template],
  ['text', text],
] as const)('%s send outcome', (_kind, send) => {
  it('a network failure (reset / dropped connection) is ambiguous', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    expect(await send()).toMatchObject({ ok: false, ambiguous: true, error: 'fetch failed' })
  })

  it('a timeout is ambiguous', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))
    expect(await send()).toMatchObject({ ok: false, ambiguous: true, error: 'send-timeout' })
  })

  it('a non-2xx gateway page with no Graph error body is ambiguous', async () => {
    respond(504, null, false)
    expect(await send()).toMatchObject({ ok: false, ambiguous: true, httpStatus: 504 })
  })

  it('a 2xx without a message id is ambiguous', async () => {
    respond(200, {})
    expect(await send()).toMatchObject({ ok: false, ambiguous: true, error: 'no-message-id' })
  })

  it("a Graph error body is Meta's answer: definite, not ambiguous", async () => {
    respond(400, { error: { message: 'Recipient not on allowed list', code: 131030 } })
    const r = await send()
    expect(r).toMatchObject({ ok: false, code: '131030', httpStatus: 400 })
    expect((r as { ambiguous?: boolean }).ambiguous).toBeUndefined()
  })

  it('even a 5xx WITH a Graph error body stays a definite answer', async () => {
    respond(500, { error: { message: 'Service unavailable', code: 2 } })
    expect((await send()) as { ambiguous?: boolean }).not.toHaveProperty('ambiguous')
  })

  it('a refusal before any request (no consent) is never ambiguous', async () => {
    const r = await send({ consent: undefined })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(r).toMatchObject({ ok: false, optOutBlocked: true })
    expect((r as { ambiguous?: boolean }).ambiguous).toBeUndefined()
  })

  it('a success carries the wamid', async () => {
    respond(200, { messages: [{ id: 'wamid.OK' }] })
    expect(await send()).toEqual({ ok: true, wamid: 'wamid.OK' })
  })
})

describe('template send timeout', () => {
  it('is bounded by default', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    respond(200, { messages: [{ id: 'wamid.OK' }] })
    await template()
    expect(timeout).toHaveBeenCalledWith(AUTOMATED_SEND_TIMEOUT_MS)
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it("keeps a caller's own timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    respond(200, { messages: [{ id: 'wamid.OK' }] })
    await template({ timeoutMs: 5_000 })
    expect(timeout).toHaveBeenCalledWith(5_000)
  })
})
