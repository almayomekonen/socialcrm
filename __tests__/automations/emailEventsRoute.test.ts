import { vi } from 'vitest'

vi.mock('@/db/automations/activity', () => ({
  getSendByProviderMessageId: vi.fn(),
  updateDeliveryStateByProviderMessageId: vi.fn(async () => 1),
}))
vi.mock('@/db/automations/emailBlocks', () => ({ addEmailBlock: vi.fn(async () => {}) }))
vi.mock('@/db/automations/suppressions', () => ({ addLeadSuppression: vi.fn(async () => {}) }))
vi.mock('@/db/quotes/invitations', () => ({ findInvitationEmailOwner: vi.fn(async () => null) }))

import crypto from 'crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/automations/email-events/route'
import { getSendByProviderMessageId, updateDeliveryStateByProviderMessageId } from '@/db/automations/activity'
import { addEmailBlock } from '@/db/automations/emailBlocks'
import { addLeadSuppression } from '@/db/automations/suppressions'
import { findInvitationEmailOwner } from '@/db/quotes/invitations'

// Delivery-events webhook (ADR-012): signature-gated, correlation-partitioned,
// idempotent, and structurally incapable of triggering an automation.

const SECRET = `whsec_${Buffer.from('engine-webhook-key').toString('base64')}`
const OWNED = { id: 5, agencyId: 7, automationId: 3, leadId: 42 }

function post(payload: unknown, opts: { secret?: string; tamper?: boolean } = {}) {
  const body = JSON.stringify(payload)
  const id = 'msg_1'
  const ts = String(Math.floor(Date.now() / 1000))
  const key = Buffer.from((opts.secret ?? SECRET).replace(/^whsec_/, ''), 'base64')
  const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')
  return POST(
    new NextRequest('https://app.example.com/api/automations/email-events', {
      method: 'POST',
      body: opts.tamper ? body.replace('re_1', 're_9') : body,
      headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` },
    }),
  )
}

const event = (type: string, data: Record<string, unknown> = {}) => ({
  type,
  data: { email_id: 're_1', to: ['dana@example.com'], ...data },
})

const noWrites = () => {
  expect(updateDeliveryStateByProviderMessageId).not.toHaveBeenCalled()
  expect(addEmailBlock).not.toHaveBeenCalled()
  expect(addLeadSuppression).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AUTOMATIONS_WEBHOOK_SECRET = SECRET
  vi.mocked(getSendByProviderMessageId).mockResolvedValue(OWNED)
  vi.mocked(updateDeliveryStateByProviderMessageId).mockResolvedValue(1)
})

describe('signature gate', () => {
  it('rejects an unsigned/tampered payload before any parsing or write', async () => {
    const res = await post(event('email.delivered'), { tamper: true })
    expect(res.status).toBe(403)
    expect(getSendByProviderMessageId).not.toHaveBeenCalled()
    noWrites()
  })

  it('rejects a payload signed with the wrong secret', async () => {
    const other = `whsec_${Buffer.from('attacker-key').toString('base64')}`
    const res = await post(event('email.delivered'), { secret: other })
    expect(res.status).toBe(403)
    noWrites()
  })

  it('refuses to process at all when the secret is unconfigured', async () => {
    delete process.env.AUTOMATIONS_WEBHOOK_SECRET
    const res = await post(event('email.delivered'))
    expect(res.status).toBe(500)
    noWrites()
  })
})

describe('correlation is the domain boundary', () => {
  it('ignores an event that matches no engine send (platform email on the shared account)', async () => {
    vi.mocked(getSendByProviderMessageId).mockResolvedValue(null)
    const res = await post(event('email.delivered'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ outcome: 'ignored' })
    noWrites()
  })

  it('ignores an event carrying no message id', async () => {
    const res = await post({ type: 'email.delivered', data: {} })
    expect(res.status).toBe(200)
    expect(getSendByProviderMessageId).not.toHaveBeenCalled()
    noWrites()
  })
})

describe('persisted events', () => {
  it('advances the ladder on delivered', async () => {
    const res = await post(event('email.delivered'))
    expect(res.status).toBe(200)
    expect(updateDeliveryStateByProviderMessageId).toHaveBeenCalledWith('re_1', 'delivered')
    expect(addEmailBlock).not.toHaveBeenCalled()
  })

  it('hard bounce advances the ladder AND blocks the bouncing address from the payload', async () => {
    const res = await post(event('email.bounced', { bounce: { type: 'Permanent' } }))
    expect(res.status).toBe(200)
    expect(updateDeliveryStateByProviderMessageId).toHaveBeenCalledWith('re_1', 'bounced')
    expect(addEmailBlock).toHaveBeenCalledWith(7, 'dana@example.com', 'hard_bounce')
  })

  it('soft bounce records the ladder but never blocks the address', async () => {
    await post(event('email.bounced', { bounce: { type: 'Transient' } }))
    expect(updateDeliveryStateByProviderMessageId).toHaveBeenCalledWith('re_1', 'bounced')
    expect(addEmailBlock).not.toHaveBeenCalled()
  })

  it('complaint suppresses the lead and leaves the ladder untouched', async () => {
    const res = await post(event('email.complained'))
    expect(res.status).toBe(200)
    expect(addLeadSuppression).toHaveBeenCalledWith(7, 42, 'spam_complaint')
    expect(updateDeliveryStateByProviderMessageId).not.toHaveBeenCalled()
  })
})

describe('ignored events write nothing', () => {
  it.each(['email.opened', 'email.clicked', 'email.delivery_delayed', 'contact.created', 'nonsense.event'])(
    '%s is ignored with a 200',
    async (type) => {
      const res = await post(event(type))
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ outcome: 'ignored' })
      noWrites()
    },
  )

  it('ignores an unparseable body without erroring', async () => {
    const body = 'not json'
    const id = 'msg_1'
    const ts = String(Math.floor(Date.now() / 1000))
    const key = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64')
    const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')
    const res = await POST(
      new NextRequest('https://app.example.com/api/automations/email-events', {
        method: 'POST',
        body,
        headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` },
      }),
    )
    expect(res.status).toBe(200)
    noWrites()
  })
})

describe('idempotency', () => {
  it('a duplicate delivered event is a no-op at the ladder and still returns 200', async () => {
    vi.mocked(updateDeliveryStateByProviderMessageId).mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    const first = await post(event('email.delivered'))
    const second = await post(event('email.delivered'))
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ ok: true })
  })

  it('replaying an out-of-order event never regresses state (guard lives in SQL, 0 rows)', async () => {
    vi.mocked(updateDeliveryStateByProviderMessageId).mockResolvedValue(0)
    const res = await post(event('email.delivered'))
    expect(res.status).toBe(200)
    expect(updateDeliveryStateByProviderMessageId).toHaveBeenCalledTimes(1)
  })
})

describe("a quote's email invitation (not an engine send)", () => {
  beforeEach(() => {
    vi.mocked(getSendByProviderMessageId).mockResolvedValue(null)
    vi.mocked(findInvitationEmailOwner).mockResolvedValue({ agencyId: 9, leadId: 55 })
  })

  it('a hard bounce blocks the address for that business, with no ladder', async () => {
    const res = await post(event('email.bounced', { bounce: { type: 'Permanent' } }))
    expect(res.status).toBe(200)
    expect(addEmailBlock).toHaveBeenCalledWith(9, 'dana@example.com', 'hard_bounce')
    expect(updateDeliveryStateByProviderMessageId).not.toHaveBeenCalled()
  })

  it('a complaint suppresses the lead', async () => {
    await post(event('email.complained'))
    expect(addLeadSuppression).toHaveBeenCalledWith(9, 55, 'spam_complaint')
  })

  it('a soft bounce or a delivery changes nothing', async () => {
    await post(event('email.bounced', { bounce: { type: 'Transient' } }))
    await post(event('email.delivered'))
    noWrites()
  })

  it('platform email (neither an engine send nor an invitation) is still ignored; a lookup failure too', async () => {
    vi.mocked(findInvitationEmailOwner).mockResolvedValueOnce(null)
    expect(await (await post(event('email.bounced', { bounce: { type: 'Permanent' } }))).json()).toMatchObject({ outcome: 'ignored' })
    vi.mocked(findInvitationEmailOwner).mockRejectedValueOnce(new Error('relation does not exist'))
    const res = await post(event('email.complained'))
    expect(res.status).toBe(200)
    noWrites()
  })
})
