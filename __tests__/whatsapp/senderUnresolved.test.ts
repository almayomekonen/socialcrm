import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'crypto'

/**
 * `whatsapp_sender_unresolved`: an inbound message dropped because it carried no
 * sender phone (`from`) — expected once WhatsApp users adopt usernames — is now
 * counted, without content or identifiers. Routing is unchanged: the message is
 * still not ingested.
 */

const track = vi.hoisted(() => vi.fn(async () => undefined))
const handleInbound = vi.hoisted(() => vi.fn(async () => ({ kick: false, delaySeconds: 0 })))
const CONNECTION = { agency_id: 69, user_id: 3, phone_number_id: 'PN1' }

vi.mock('@/lib/analytics/track', () => ({ track }))
vi.mock('@/lib/whatsapp/handleInboundWebhookMessage', () => ({ handleInboundWebhookMessage: handleInbound }))
vi.mock('@/lib/inbox/autoresponse/kickWorker', () => ({ runAutoResponseKick: vi.fn() }))
vi.mock('@/lib/inbox/ingestWhatsappStatuses', () => ({ ingestWhatsappStatuses: vi.fn() }))
vi.mock('@/config/db', () => ({
  db: Object.assign(
    (table: string) =>
      table === 'whatsapp_connections'
        ? { where: () => ({ first: async () => CONNECTION }) }
        : { where: () => ({ first: async () => undefined }) },
    { fn: { now: () => new Date() } },
  ),
}))

const SECRET = 'test-app-secret'
process.env.META_APP_SECRET = SECRET
const { POST } = await import('@/app/api/webhooks/whatsapp/route')

const BSUID = 'IL.13491208655302741918'
function signed(messages: Array<Record<string, unknown>>): Request {
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550783881', phone_number_id: 'PN1' },
              contacts: [{ profile: { name: 'Dana' }, user_id: BSUID }],
              messages,
            },
          },
        ],
      },
    ],
  })
  const sig = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex')
  return new Request('https://getsocialcrm.com/api/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'x-hub-signature-256': sig, 'content-type': 'application/json' },
    body: raw,
  })
}
const usernameMessage = { from_user_id: BSUID, id: 'wamid.NOPHONE', timestamp: '1760000000', type: 'text', text: { body: 'שלום, מה המחיר?' } }

beforeEach(() => {
  track.mockClear()
  handleInbound.mockClear()
})

describe('an inbound message without a sender phone', () => {
  it('is still not ingested (no routing change), and is counted once, for the right agency', async () => {
    const res = await POST(signed([usernameMessage]) as never)
    expect(res.status).toBe(200)
    expect(handleInbound).not.toHaveBeenCalled()
    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith({
      agencyId: 69,
      event: 'whatsapp_sender_unresolved',
      props: { reason: 'missing_from', hasUserId: true, hasMessageId: true, messageType: 'text' },
    })
  })

  it('carries no content and no identifier of any kind', async () => {
    await POST(signed([usernameMessage]) as never)
    const sent = JSON.stringify(track.mock.calls)
    for (const secret of [BSUID, 'wamid.NOPHONE', 'שלום', 'PN1', 'WABA_1', 'Dana', '15550783881']) expect(sent).not.toContain(secret)
  })

  it('records whether a user id was present at all', async () => {
    await POST(signed([{ id: 'wamid.BARE', timestamp: '1760000000', type: 'image' }]) as never)
    expect(track).toHaveBeenCalledWith(expect.objectContaining({ props: { reason: 'missing_from', hasUserId: false, hasMessageId: true, messageType: 'image' } }))
  })
})

describe('everything else is unchanged', () => {
  it('a message with a phone is handled as before and emits no event', async () => {
    await POST(signed([{ ...usernameMessage, from: '972501111111', id: 'wamid.PHONE' }]) as never)
    expect(handleInbound).toHaveBeenCalledTimes(1)
    expect(track).not.toHaveBeenCalled()
  })

  it('a message with a phone but no message id is dropped as before, without this event', async () => {
    await POST(signed([{ from: '972501111111', type: 'text' }]) as never)
    expect(handleInbound).not.toHaveBeenCalled()
    expect(track).not.toHaveBeenCalled()
  })

  it('in a mixed batch, only the phone-less message is counted and the other is handled', async () => {
    await POST(signed([usernameMessage, { ...usernameMessage, from: '972501111111', id: 'wamid.PHONE' }]) as never)
    expect(track).toHaveBeenCalledTimes(1)
    expect(handleInbound).toHaveBeenCalledTimes(1)
  })
})
