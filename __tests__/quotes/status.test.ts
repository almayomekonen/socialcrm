import { describe, expect, it } from 'vitest'
import { effectiveQuoteStatus, expiryDateFrom, isQuoteExpired, QUOTE_STATUSES } from '@/lib/quotes/status'

/**
 * Expiry is DERIVED in v1 — nothing writes an `expired` row. These tests pin
 * the derivation, including the two places it could quietly be wrong: the
 * inclusive boundary, and a DST transition.
 *
 * Asia/Jerusalem is UTC+3 in August, so 21:00Z is already the next calendar day
 * in the business timezone. Every "device timezone" bug in this repo's history
 * looks like that, which is why the boundary cases below are written in UTC.
 */

const at = (iso: string) => Date.parse(iso)

describe('the status vocabulary is append-only', () => {
  it('declares exactly the values the CHECK constraint admits', () => {
    expect([...QUOTE_STATUSES]).toEqual(['draft', 'ready', 'sent', 'accepted', 'declined', 'expired'])
  })
})

describe('isQuoteExpired', () => {
  it('a quote expiring TODAY is not expired — you have until the 23rd', () => {
    expect(isQuoteExpired({ status: 'sent', expiresAt: '2026-08-23' }, at('2026-08-23T09:00:00Z'))).toBe(false)
  })

  it('a quote is expired the day after its validity date', () => {
    expect(isQuoteExpired({ status: 'sent', expiresAt: '2026-08-23' }, at('2026-08-24T06:00:00Z'))).toBe(true)
  })

  it('only a SENT quote can expire', () => {
    const past = at('2026-08-24T06:00:00Z')
    expect(isQuoteExpired({ status: 'draft', expiresAt: '2026-08-23' }, past)).toBe(false)
    expect(isQuoteExpired({ status: 'ready', expiresAt: '2026-08-23' }, past)).toBe(false)
    // A decided quote has an answer that expiry cannot overrule.
    expect(isQuoteExpired({ status: 'accepted', expiresAt: '2026-08-23' }, past)).toBe(false)
    expect(isQuoteExpired({ status: 'declined', expiresAt: '2026-08-23' }, past)).toBe(false)
  })

  it('a quote with no validity date never expires', () => {
    expect(isQuoteExpired({ status: 'sent', expiresAt: null }, at('2030-01-01T00:00:00Z'))).toBe(false)
  })

  it('the boundary is the BUSINESS day, not UTC', () => {
    // 2026-08-23T21:30:00Z is already 2026-08-24 in Asia/Jerusalem (UTC+3),
    // so a quote valid through the 23rd has just expired — even though UTC
    // still reads the 23rd.
    expect(isQuoteExpired({ status: 'sent', expiresAt: '2026-08-23' }, at('2026-08-23T21:30:00Z'))).toBe(true)
    // …and an hour earlier it had not.
    expect(isQuoteExpired({ status: 'sent', expiresAt: '2026-08-23' }, at('2026-08-23T20:30:00Z'))).toBe(false)
  })

  it('tolerates a timestamp-shaped value from pg’s date column', () => {
    expect(isQuoteExpired({ status: 'sent', expiresAt: '2026-08-23T00:00:00.000Z' }, at('2026-08-24T06:00:00Z'))).toBe(true)
  })
})

describe('effectiveQuoteStatus', () => {
  it('folds expiry into the displayed status without changing the stored one', () => {
    const quote = { status: 'sent' as const, expiresAt: '2026-08-23' }
    expect(effectiveQuoteStatus(quote, at('2026-08-23T09:00:00Z'))).toBe('sent')
    expect(effectiveQuoteStatus(quote, at('2026-08-25T09:00:00Z'))).toBe('expired')
    // The input is untouched — this is a read-time view.
    expect(quote.status).toBe('sent')
  })
})

describe('expiryDateFrom', () => {
  it('adds calendar days to the business date', () => {
    expect(expiryDateFrom(at('2026-08-09T09:00:00Z'), 14)).toBe('2026-08-23')
    expect(expiryDateFrom(at('2026-08-09T09:00:00Z'), 1)).toBe('2026-08-10')
  })

  it('anchors on the BUSINESS date, so a late-evening quote does not lose a day', () => {
    // 21:30Z on the 9th is already the 10th in Asia/Jerusalem.
    expect(expiryDateFrom(at('2026-08-09T21:30:00Z'), 14)).toBe('2026-08-24')
  })

  it('crosses a DST transition without gaining or losing a day', () => {
    // Israel springs forward on 2026-03-27. Fourteen calendar days from the
    // 20th is the 3rd of April whatever the clocks do in between — the failure
    // this guards is millisecond arithmetic over a 23-hour day landing on the 2nd.
    expect(expiryDateFrom(at('2026-03-20T09:00:00Z'), 14)).toBe('2026-04-03')
    // …and the autumn transition, a 25-hour day.
    expect(expiryDateFrom(at('2026-10-20T09:00:00Z'), 14)).toBe('2026-11-03')
  })

  it('crosses a month and a year boundary', () => {
    expect(expiryDateFrom(at('2026-12-28T09:00:00Z'), 14)).toBe('2027-01-11')
  })

  it('a non-positive window resolves to today rather than to the past', () => {
    expect(expiryDateFrom(at('2026-08-09T09:00:00Z'), 0)).toBe('2026-08-09')
    expect(expiryDateFrom(at('2026-08-09T09:00:00Z'), -5)).toBe('2026-08-09')
  })
})
