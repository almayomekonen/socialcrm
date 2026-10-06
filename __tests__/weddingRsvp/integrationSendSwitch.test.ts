import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { signBody } from '@/lib/weddingRsvp/integrationAuth'

/** send-invitation is OFF unless WEDDING_INTEGRATION_SEND_ENABLED=true — even with a valid signature. */

const send = vi.hoisted(() => vi.fn())
vi.mock('@/lib/weddingRsvp/integration', () => ({
  parseSendInput: (b: unknown) => b,
  sendInvitationViaIntegration: send,
}))

const SECRET = 'z'.repeat(40)
const body = JSON.stringify({ invitationId: '00000000-0000-4000-8000-000000000000', phone: '972500000001', firstName: 'x', lastName: '' })

function signedRequest() {
  const ts = Math.floor(Date.now() / 1000)
  return new Request('http://localhost/api/internal/wedding/send-invitation', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wedding-timestamp': String(ts), 'x-wedding-signature': signBody(SECRET, ts, body) },
    body,
  })
}

describe('send-invitation send switch', () => {
  const saved = { secret: process.env.WEDDING_INTEGRATION_SECRET, send: process.env.WEDDING_INTEGRATION_SEND_ENABLED }
  beforeEach(() => {
    send.mockReset()
    send.mockResolvedValue({ httpStatus: 200, body: { accepted: true, wamid: 'wamid.X', status: 'sent', replay: false } })
    process.env.WEDDING_INTEGRATION_SECRET = SECRET
    delete process.env.WEDDING_INTEGRATION_SEND_ENABLED
  })
  afterEach(() => {
    process.env.WEDDING_INTEGRATION_SECRET = saved.secret
    if (saved.send === undefined) delete process.env.WEDDING_INTEGRATION_SEND_ENABLED
    else process.env.WEDDING_INTEGRATION_SEND_ENABLED = saved.send
  })

  it('a validly signed request is refused while sending is not enabled — nothing is called', async () => {
    const { POST } = await import('@/app/api/internal/wedding/send-invitation/route')
    for (const v of [undefined, '', 'false', '1', 'TRUE']) {
      if (v === undefined) delete process.env.WEDDING_INTEGRATION_SEND_ENABLED
      else process.env.WEDDING_INTEGRATION_SEND_ENABLED = v
      const res = await POST(signedRequest() as never)
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ accepted: false, error: 'sending-disabled' })
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('an unsigned request is still 401 first (the switch does not reveal itself)', async () => {
    const { POST } = await import('@/app/api/internal/wedding/send-invitation/route')
    const res = await POST(new Request('http://localhost/x', { method: 'POST', body }) as never)
    expect(res.status).toBe(401)
    expect(send).not.toHaveBeenCalled()
  })

  it('with WEDDING_INTEGRATION_SEND_ENABLED=true the signed request reaches the send service', async () => {
    process.env.WEDDING_INTEGRATION_SEND_ENABLED = 'true'
    const { POST } = await import('@/app/api/internal/wedding/send-invitation/route')
    const res = await POST(signedRequest() as never)
    expect(res.status).toBe(200)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
