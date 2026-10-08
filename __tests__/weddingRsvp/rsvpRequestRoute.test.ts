import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { signBody } from '@/lib/weddingRsvp/integrationAuth'

/** send-rsvp-request: HMAC first, then its OWN switch (fail-closed), then strict input. */

const send = vi.hoisted(() => vi.fn())
vi.mock('@/lib/weddingRsvp/integrationRsvp', async (orig) => ({
  ...(await orig<typeof import('@/lib/weddingRsvp/integrationRsvp')>()),
  sendRsvpRequestViaIntegration: send,
}))

const SECRET = 'q'.repeat(40)
const valid = { requestId: 'aaaaaaaa-1111-4111-8111-111111111111', phone: '972500000001', firstName: 'x', lastName: '' }

function signed(body: unknown) {
  const raw = JSON.stringify(body)
  const ts = Math.floor(Date.now() / 1000)
  return new Request('http://localhost/api/internal/wedding/send-rsvp-request', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wedding-timestamp': String(ts), 'x-wedding-signature': signBody(SECRET, ts, raw) },
    body: raw,
  })
}

describe('send-rsvp-request route', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    send.mockReset()
    send.mockResolvedValue({ httpStatus: 200, body: { accepted: true, wamid: 'wamid.X', status: 'sent', replay: false } })
    process.env.WEDDING_INTEGRATION_SECRET = SECRET
    delete process.env.WEDDING_INTEGRATION_RSVP_SEND_ENABLED
    process.env.WEDDING_INTEGRATION_SEND_ENABLED = 'true' // the INVITE switch must not open the RSVP send
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it('unsigned → 401, nothing called', async () => {
    const { POST } = await import('@/app/api/internal/wedding/send-rsvp-request/route')
    const res = await POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(valid) }) as never)
    expect(res.status).toBe(401)
    expect(send).not.toHaveBeenCalled()
  })

  it('signed but the RSVP switch is off (even with the invite switch on) → 503 rsvp-sending-disabled', async () => {
    const { POST } = await import('@/app/api/internal/wedding/send-rsvp-request/route')
    for (const v of [undefined, '', 'false', '1', 'TRUE']) {
      if (v === undefined) delete process.env.WEDDING_INTEGRATION_RSVP_SEND_ENABLED
      else process.env.WEDDING_INTEGRATION_RSVP_SEND_ENABLED = v
      const res = await POST(signed(valid) as never)
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ accepted: false, error: 'rsvp-sending-disabled' })
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('switch on: invalid input → 400; valid → the service gets ONLY requestId/phone/names', async () => {
    process.env.WEDDING_INTEGRATION_RSVP_SEND_ENABLED = 'true'
    const { POST } = await import('@/app/api/internal/wedding/send-rsvp-request/route')
    expect((await POST(signed({ ...valid, requestId: 'x' }) as never)).status).toBe(400)
    const res = await POST(signed({ ...valid, template: 'other_template', body: 'free text' }) as never)
    expect(res.status).toBe(200)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toEqual(valid)
  })
})
