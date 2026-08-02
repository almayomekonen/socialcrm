import crypto from 'crypto'
import { describe, expect, it } from 'vitest'
import { decideDeliveryEvent, isHardBounce, recipientFrom, verifyWebhookSignature } from '@/lib/automations/deliveryEvents'

// ADR-012 conformance for the pure ingestion logic: the classification table
// must mirror the ADR exactly, and signature verification must reject every
// tampering path.

const SECRET = `whsec_${Buffer.from('super-secret-key-material').toString('base64')}`
const NOW_MS = 1_754_136_000_000 // 2025-08-02T12:00:00Z
const TS = String(Math.floor(NOW_MS / 1000))
const ID = 'msg_2abc'
const BODY = '{"type":"email.delivered","data":{"email_id":"re_1"}}'

function sign(body: string, id = ID, ts = TS, secret = SECRET): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  return crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')
}

const verify = (over: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) =>
  verifyWebhookSignature({
    secret: SECRET,
    id: ID,
    timestamp: TS,
    signatureHeader: `v1,${sign(BODY)}`,
    body: BODY,
    nowMs: NOW_MS,
    ...over,
  })

describe('verifyWebhookSignature', () => {
  it('accepts a correctly signed payload', () => {
    expect(verify()).toBe(true)
  })

  it('accepts a header carrying several signatures when one matches (key rotation)', () => {
    expect(verify({ signatureHeader: `v1,${'A'.repeat(44)} v1,${sign(BODY)}` })).toBe(true)
  })

  it('rejects a tampered body', () => {
    expect(verify({ body: BODY.replace('re_1', 're_2') })).toBe(false)
  })

  it('rejects a signature made with a different secret', () => {
    const other = `whsec_${Buffer.from('another-key').toString('base64')}`
    expect(verify({ signatureHeader: `v1,${sign(BODY, ID, TS, other)}` })).toBe(false)
  })

  it('rejects a replayed id or timestamp mismatch', () => {
    expect(verify({ id: 'msg_other' })).toBe(false)
    expect(verify({ timestamp: String(Number(TS) + 1) })).toBe(false)
  })

  it('rejects timestamps outside the tolerance window', () => {
    const stale = String(Math.floor(NOW_MS / 1000) - 6 * 60)
    expect(verify({ timestamp: stale, signatureHeader: `v1,${sign(BODY, ID, stale)}` })).toBe(false)
  })

  it('rejects missing headers, empty secret, and unknown signature versions', () => {
    expect(verify({ id: null })).toBe(false)
    expect(verify({ timestamp: null })).toBe(false)
    expect(verify({ signatureHeader: null })).toBe(false)
    expect(verify({ secret: '' })).toBe(false)
    expect(verify({ signatureHeader: `v2,${sign(BODY)}` })).toBe(false)
  })
})

describe('decideDeliveryEvent — the ADR-012 table, verbatim', () => {
  it('persists the ladder events', () => {
    expect(decideDeliveryEvent('email.sent', null)).toEqual({ effect: 'ladder', state: 'sent' })
    expect(decideDeliveryEvent('email.delivered', null)).toEqual({ effect: 'ladder', state: 'delivered' })
  })

  it('blocks the address only on an explicit hard bounce', () => {
    expect(decideDeliveryEvent('email.bounced', { bounce: { type: 'Permanent' } })).toEqual({
      effect: 'ladder_and_block',
      state: 'bounced',
    })
    expect(decideDeliveryEvent('email.bounced', { bounce: { type: 'Transient' } })).toEqual({
      effect: 'ladder',
      state: 'bounced',
    })
    expect(decideDeliveryEvent('email.bounced', null)).toEqual({ effect: 'ladder', state: 'bounced' })
  })

  it('treats a complaint as suppression, never as a delivery failure', () => {
    expect(decideDeliveryEvent('email.complained', null)).toEqual({ effect: 'suppress' })
  })

  it('IGNORES engagement events — opens and clicks are never ingested', () => {
    expect(decideDeliveryEvent('email.opened', null)).toEqual({ effect: 'ignore', reason: 'engagement_not_ingested' })
    expect(decideDeliveryEvent('email.clicked', null)).toEqual({ effect: 'ignore', reason: 'engagement_not_ingested' })
  })

  it('ignores non-terminal and unrecognized types', () => {
    expect(decideDeliveryEvent('email.delivery_delayed', null)).toEqual({ effect: 'ignore', reason: 'non_terminal' })
    expect(decideDeliveryEvent('contact.created', null)).toEqual({ effect: 'ignore', reason: 'unrecognized_event_type' })
    expect(decideDeliveryEvent('domain.updated', null)).toEqual({ effect: 'ignore', reason: 'unrecognized_event_type' })
    expect(decideDeliveryEvent('', null)).toEqual({ effect: 'ignore', reason: 'unrecognized_event_type' })
  })

  it('never produces an effect that could add a send', () => {
    const types = ['email.sent', 'email.delivered', 'email.bounced', 'email.complained', 'email.opened', 'anything.else']
    for (const t of types) {
      const d = decideDeliveryEvent(t, { bounce: { type: 'Permanent' } })
      expect(['ladder', 'ladder_and_block', 'suppress', 'ignore']).toContain(d.effect)
    }
  })
})

describe('helpers', () => {
  it('isHardBounce is conservative — unknown shapes are not hard', () => {
    expect(isHardBounce({ bounce_type: 'HardBounce' })).toBe(true)
    expect(isHardBounce({ bounce: { type: 'permanent' } })).toBe(true)
    expect(isHardBounce({ bounce: { type: 'Undetermined' } })).toBe(false)
    expect(isHardBounce({})).toBe(false)
    expect(isHardBounce(null)).toBe(false)
  })

  it('recipientFrom reads the address from the event payload', () => {
    expect(recipientFrom({ to: ['dana@example.com'] })).toBe('dana@example.com')
    expect(recipientFrom({ to: 'dana@example.com' })).toBe('dana@example.com')
    expect(recipientFrom({ to: [] })).toBeNull()
    expect(recipientFrom(null)).toBeNull()
  })
})
