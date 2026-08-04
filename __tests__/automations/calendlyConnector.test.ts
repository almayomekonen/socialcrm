import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { calendlyProvider } from '@/lib/automations/connectors/calendly'
import { isWebhookConnector } from '@/lib/automations/connectors/types'
import { catalog, getEvent } from '@/lib/automations/catalog/registry'

/**
 * B7 — the Calendly connector against the generic contract.
 *
 * These are the only Calendly-aware assertions in the suite, and they live
 * beside the only Calendly-aware module. Everything else about B7 is tested
 * generically, which is the point.
 */

const SECRET = 'whsec_test'

const sign = (body: string, at = '1754140800') => {
  const v1 = crypto.createHmac('sha256', SECRET).update(`${at}.${body}`).digest('hex')
  return { 'calendly-webhook-signature': `t=${at},v1=${v1}`, 'x-connection-secret': SECRET }
}

const BOOKING = {
  event: 'invitee.created',
  payload: {
    uri: 'https://api.calendly.com/scheduled_events/EV1/invitees/IN1',
    email: 'Dana@Example.com',
    name: 'דנה לוי',
    text_reminder_number: '+972-50-123-4567',
    scheduled_event: {
      uri: 'https://api.calendly.com/scheduled_events/EV1',
      name: 'שיחת ייעוץ',
      start_time: '2026-08-12T10:00:00.000Z',
    },
  },
}

describe('it satisfies the contract the generic layer requires', () => {
  it('is a webhook connector — all three inbound members present', () => {
    expect(isWebhookConnector(calendlyProvider)).toBe(true)
  })

  it('declares the capability the catalog event requires', () => {
    const required = getEvent('appointment.booked')!.requirements.map((r) => r.key)
    expect(calendlyProvider.capabilities).toEqual(expect.arrayContaining(required))
  })
})

describe('verifyWebhook', () => {
  const body = JSON.stringify(BOOKING)

  it('accepts a correctly signed body', () => {
    expect(calendlyProvider.verifyWebhook!({ headers: sign(body), body })).toBe(true)
  })

  it('rejects a tampered body', () => {
    const headers = sign(body)
    expect(calendlyProvider.verifyWebhook!({ headers, body: body.replace('דנה', 'רונה') })).toBe(false)
  })

  it('rejects a wrong secret', () => {
    const headers = sign(body)
    headers['x-connection-secret'] = 'whsec_other'
    expect(calendlyProvider.verifyWebhook!({ headers, body })).toBe(false)
  })

  it('rejects a missing, malformed or empty signature rather than passing', () => {
    expect(calendlyProvider.verifyWebhook!({ headers: {}, body })).toBe(false)
    expect(calendlyProvider.verifyWebhook!({ headers: { 'x-connection-secret': SECRET }, body })).toBe(false)
    expect(
      calendlyProvider.verifyWebhook!({
        headers: { 'calendly-webhook-signature': 'garbage', 'x-connection-secret': SECRET },
        body,
      }),
    ).toBe(false)
  })

  it('rejects a signature of the wrong length without throwing', () => {
    expect(
      calendlyProvider.verifyWebhook!({
        headers: { 'calendly-webhook-signature': 't=1,v1=abcd', 'x-connection-secret': SECRET },
        body,
      }),
    ).toBe(false)
  })
})

describe('mapEvent — provider vocabulary in, CATALOG vocabulary out', () => {
  it('produces the catalog event key, the occurrence identity and catalog-keyed fields', () => {
    const mapped = calendlyProvider.mapEvent!(BOOKING)!
    expect(mapped.eventKey).toBe('appointment.booked')
    expect(mapped.occurrenceKey).toBe('appointment:https://api.calendly.com/scheduled_events/EV1/invitees/IN1')
    expect(mapped.fields).toEqual({
      startsAt: new Date('2026-08-12T10:00:00.000Z'),
      appointmentName: 'שיחת ייעוץ',
      inviteeEmail: 'Dana@Example.com',
    })
    expect(mapped.subject).toEqual({ email: 'Dana@Example.com', phone: '+972-50-123-4567' })
  })

  it('every mapped field key is one the catalog event DECLARES — no invented data', () => {
    const declared = new Set(getEvent('appointment.booked')!.fields.map((f) => f.key))
    for (const key of Object.keys(calendlyProvider.mapEvent!(BOOKING)!.fields)) {
      expect(declared.has(key), `mapped an undeclared field "${key}"`).toBe(true)
    }
  })

  it('returns null for a payload type it does not act on — never a throw, never a guess', () => {
    expect(calendlyProvider.mapEvent!({ event: 'invitee.canceled', payload: BOOKING.payload })).toBe(null)
    expect(calendlyProvider.mapEvent!({})).toBe(null)
    expect(calendlyProvider.mapEvent!(null)).toBe(null)
    expect(calendlyProvider.mapEvent!('not an object')).toBe(null)
  })

  it('returns null when the occurrence has no identity or no start time', () => {
    expect(calendlyProvider.mapEvent!({ event: 'invitee.created', payload: { email: 'a@b.co' } })).toBe(null)
    expect(
      calendlyProvider.mapEvent!({
        event: 'invitee.created',
        payload: { uri: 'u', scheduled_event: { start_time: 'not-a-date' } },
      }),
    ).toBe(null)
  })
})

describe('options — the generic enum_remote provider', () => {
  it('answers nothing for an option source it does not declare (Law 3)', async () => {
    expect(await calendlyProvider.options(1, 'calendly:1', 'products')).toEqual([])
  })

  it('answers nothing for a connection id belonging to another integration', async () => {
    expect(await calendlyProvider.listSources(1, 'whatsapp:5')).toEqual([])
    expect(await calendlyProvider.listSources(1, 'calendly:not-a-number')).toEqual([])
  })

  /**
   * The coupling this used to assert — Calendly's `event_types` answering the
   * appointment event's declared picker — was CUT when the Meetings domain
   * became the producer of `appointment.booked`. A meeting booked in the CRM has
   * no event types to choose between, so the event declares no remote parameter
   * and the Builder renders no dropdown that could never be filled.
   *
   * The invariant worth keeping is the general one, and it is stronger: every
   * remote picker the catalog declares must be answerable by some connector.
   * Calendly's unreferenced option source is harmless in the other direction —
   * a provider that can answer more than anything currently asks.
   */
  it('every enum_remote the catalog declares is answerable by a registered connector', () => {
    const declared = catalog.events.flatMap((e) => e.parameters.filter((p) => p.type === 'enum_remote'))
    for (const parameter of declared) {
      expect(parameter.optionSource, `${parameter.key} declares no option source`).toBeTruthy()
    }
    // The appointment occurrence is internal now: no connection, no picker.
    expect(getEvent('appointment.booked')!.parameters).toEqual([])
    expect(getEvent('appointment.booked')!.requirements).toEqual([])
  })
})
