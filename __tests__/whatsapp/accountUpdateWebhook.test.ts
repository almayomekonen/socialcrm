/**
 * The WhatsApp webhook route hands `account_update` to processAccountUpdate and
 * always acknowledges it with 200 — even when processing throws — and never
 * treats it as inbound messages or statuses. Signature checking is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'crypto'

const h = vi.hoisted(() => ({
  process: vi.fn(async (_entryId?: unknown, _value?: unknown) => ({ action: 'disconnected', matched: 1, transitioned: 1 })),
  inbound: vi.fn(),
  statuses: vi.fn(async () => {}),
}))
vi.mock('@/lib/whatsapp/accountUpdate', () => ({ processAccountUpdate: h.process }))
vi.mock('@/lib/whatsapp/handleInboundWebhookMessage', () => ({ handleInboundWebhookMessage: h.inbound }))
vi.mock('@/lib/inbox/ingestWhatsappStatuses', () => ({ ingestWhatsappStatuses: h.statuses }))
vi.mock('@/config/db', () => ({ db: () => ({ where: () => ({ first: async () => undefined }) }) }))

const SECRET = 'test-app-secret'
process.env.META_APP_SECRET = SECRET
const { POST } = await import('@/app/api/webhooks/whatsapp/route')

function signed(body: unknown, secret = SECRET): Request {
  const raw = JSON.stringify(body)
  const sig = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex')
  return new Request('https://getsocialcrm.com/api/webhooks/whatsapp', { method: 'POST', headers: { 'x-hub-signature-256': sig, 'content-type': 'application/json' }, body: raw })
}
const accountUpdate = (value: unknown, id = '2949482758682047') => ({ object: 'whatsapp_business_account', entry: [{ id, time: 1748477359, changes: [{ field: 'account_update', value }] }] })

beforeEach(() => {
  h.process.mockClear()
  h.inbound.mockClear()
  h.statuses.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('account_update in the webhook route', () => {
  it('passes entry.id and the value to processAccountUpdate, acknowledges 200, touches no message path', async () => {
    const value = { event: 'PARTNER_REMOVED', waba_info: { waba_id: '980198427658004' }, disconnection_info: { reason: 'PRIMARY_INACTIVITY', initiated_by: 'SYSTEM' } }
    const res = await POST(signed(accountUpdate(value)) as never)
    expect(res.status).toBe(200)
    expect(h.process).toHaveBeenCalledWith('2949482758682047', value)
    expect(h.inbound).not.toHaveBeenCalled()
    expect(h.statuses).not.toHaveBeenCalled()
  })

  it('still acknowledges 200 when processing throws (no Meta retry storm)', async () => {
    h.process.mockRejectedValueOnce(new Error('db down'))
    const res = await POST(signed(accountUpdate({ event: 'ACCOUNT_OFFBOARDED' })) as never)
    expect(res.status).toBe(200)
  })

  it('an unknown event is acknowledged too', async () => {
    h.process.mockResolvedValueOnce({ action: 'ignored', reason: 'unhandled_event' } as never)
    expect((await POST(signed(accountUpdate({ event: 'SOMETHING_NEW' })) as never)).status).toBe(200)
  })

  it('a bad signature is still rejected before any processing', async () => {
    const res = await POST(signed(accountUpdate({ event: 'ACCOUNT_OFFBOARDED' }), 'wrong-secret') as never)
    expect(res.status).toBe(403)
    expect(h.process).not.toHaveBeenCalled()
  })
})
