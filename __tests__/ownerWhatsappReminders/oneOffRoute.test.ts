import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/** The one-off route: 404 unless configured, CRON_SECRET only, POST only, body `{ conversationId }` only. */
const send = vi.fn()
vi.mock('@/lib/ownerWhatsappReminders/oneOffSend', () => ({ sendOneOffReminder: (...a: unknown[]) => send(...a) }))

const SECRET = 'cron-secret-not-real-0123456789'
const route = () => import('@/app/api/internal/owner-wa/one-off-send/route')
const post = (body: unknown, auth: string | null = `Bearer ${SECRET}`) =>
  new NextRequest('https://getsocialcrm.com/api/internal/owner-wa/one-off-send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

beforeEach(() => {
  process.env.CRON_SECRET = SECRET
  process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID = '1'
  send.mockReset()
  send.mockResolvedValue({ outcome: 'sent', deliveryId: 7, wamid: 'wamid.X' })
})
afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID
})

describe('one-off send route', () => {
  it('404 when OWNER_WA_ONE_OFF_RECIPIENT_ID is unset or invalid, even with the right secret', async () => {
    const { POST } = await route()
    for (const v of [undefined, '', '0', 'all', '-1', '1; DROP']) {
      if (v === undefined) delete process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID
      else process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID = v
      expect((await POST(post({ conversationId: 5 }))).status).toBe(404)
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('403 without the CRON_SECRET bearer, 500 when CRON_SECRET is unset', async () => {
    const { POST } = await route()
    for (const auth of [null, 'Bearer wrong', SECRET, `Basic ${SECRET}`]) expect((await POST(post({ conversationId: 5 }, auth))).status).toBe(403)
    delete process.env.CRON_SECRET
    expect((await POST(post({ conversationId: 5 }))).status).toBe(500)
    expect(send).not.toHaveBeenCalled()
  })

  it('POST only: there is no GET handler', async () => {
    const mod = await route()
    expect((mod as Record<string, unknown>).GET).toBeUndefined()
  })

  it.each([
    ['a recipient override', { conversationId: 5, recipientId: 2 }],
    ['a phone number', { conversationId: 5, to: '972500000000' }],
    ['a string id', { conversationId: '5' }],
    ['a fractional id', { conversationId: 5.5 }],
    ['a zero id', { conversationId: 0 }],
    ['an unknown mode', { conversationId: 5, mode: 'fast' }],
    ['a mode with an override', { conversationId: 5, mode: 'immediate', to: '972500000000' }],
    ['no id', {}],
    ['an array', [5]],
    ['invalid JSON', '{'],
  ])('400 for %s, and nothing is sent', async (_label, body) => {
    const { POST } = await route()
    expect((await POST(post(body))).status).toBe(400)
    expect(send).not.toHaveBeenCalled()
  })

  it('passes only the conversation id and returns the outcome', async () => {
    const { POST } = await route()
    const res = await POST(post({ conversationId: 5 }))
    expect(res.status).toBe(200)
    expect(send).toHaveBeenCalledWith({ conversationId: 5, mode: 'standard' })
    expect(await res.json()).toEqual({ ok: true, outcome: 'sent', deliveryId: 7, wamid: 'wamid.X' })
  })

  it('passes mode immediate through, and nothing else', async () => {
    const { POST } = await route()
    expect((await POST(post({ conversationId: 5, mode: 'immediate' }))).status).toBe(200)
    expect(send).toHaveBeenCalledWith({ conversationId: 5, mode: 'immediate' })
  })

  it('409 for a refusal, 500 for an interrupted attempt', async () => {
    const { POST } = await route()
    send.mockResolvedValueOnce({ outcome: 'refused', reason: 'already_used' })
    expect((await POST(post({ conversationId: 5 }))).status).toBe(409)
    send.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'ECONNRESET' }))
    const res = await POST(post({ conversationId: 5 }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, outcome: 'error' })
  })
})
