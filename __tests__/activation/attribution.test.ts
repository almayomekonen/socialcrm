/**
 * Signup attribution — pure parsing, sanitising and the first-touch rule.
 *
 * The module is deliberately pure so it can be tested without a browser, a
 * cookie jar or a database. These cases pin the behaviour the funnel depends on:
 * an ad click is never lost, an organic visit never overwrites one, and nothing
 * a hostile URL can carry reaches the jsonb column.
 */
import { describe, expect, it } from 'vitest'
import {
  hasAttribution,
  parseAttribution,
  readAttributionFromUrl,
  serializeAttribution,
  shouldOverwriteAttribution,
} from '@/lib/activation/attribution'

describe('readAttributionFromUrl', () => {
  it('captures utm params, fbclid and gclid', () => {
    const attr = readAttributionFromUrl(
      '?utm_source=facebook&utm_medium=cpc&utm_campaign=leads_aug&utm_content=vid_a&utm_term=crm&fbclid=ABC123&gclid=XYZ',
      '',
      'getsocialcrm.com',
    )
    expect(attr).toEqual({
      utm_source: 'facebook',
      utm_medium: 'cpc',
      utm_campaign: 'leads_aug',
      utm_content: 'vid_a',
      utm_term: 'crm',
      fbclid: 'ABC123',
      gclid: 'XYZ',
    })
  })

  it('reduces the referrer to its hostname and drops the path', () => {
    const attr = readAttributionFromUrl('', 'https://l.facebook.com/l.php?u=secret&token=abc', 'getsocialcrm.com')
    expect(attr.referrer).toBe('l.facebook.com')
    expect(JSON.stringify(attr)).not.toContain('secret')
    expect(JSON.stringify(attr)).not.toContain('token')
  })

  it('ignores a same-origin referrer — internal navigation attributes nothing', () => {
    const attr = readAttributionFromUrl('', 'https://getsocialcrm.com/crm', 'getsocialcrm.com')
    expect(hasAttribution(attr)).toBe(false)
  })

  it('drops unknown params rather than storing them', () => {
    const attr = readAttributionFromUrl('?evil=1&utm_source=ig&__proto__=x', '', 'getsocialcrm.com')
    expect(attr).toEqual({ utm_source: 'ig' })
  })

  it('caps absurdly long values', () => {
    const attr = readAttributionFromUrl(`?utm_campaign=${'x'.repeat(5000)}`, '', 'getsocialcrm.com')
    expect(attr.utm_campaign!.length).toBe(200)
  })

  it('strips control characters', () => {
    const attr = readAttributionFromUrl('?utm_source=fa%00ce%09book', '', 'getsocialcrm.com')
    expect(attr.utm_source).toBe('facebook')
  })

  it('survives a malformed referrer', () => {
    expect(() => readAttributionFromUrl('', 'not a url', 'getsocialcrm.com')).not.toThrow()
    expect(readAttributionFromUrl('', 'not a url', 'getsocialcrm.com').referrer).toBeUndefined()
  })

  it('returns nothing for a bare organic visit', () => {
    expect(hasAttribution(readAttributionFromUrl('', '', 'getsocialcrm.com'))).toBe(false)
  })
})

describe('shouldOverwriteAttribution — first touch, except a fresh ad click', () => {
  it('stores the first attribution when none exists', () => {
    expect(shouldOverwriteAttribution(null, { referrer: 'google.com' })).toBe(true)
  })

  it('does NOT let a later organic visit overwrite the ad that acquired them', () => {
    const stored = { utm_source: 'facebook', utm_campaign: 'leads_aug' }
    expect(shouldOverwriteAttribution(stored, { referrer: 'google.com' })).toBe(false)
  })

  it('DOES let a fresh ad click overwrite an earlier organic visit', () => {
    const stored = { referrer: 'google.com' }
    expect(shouldOverwriteAttribution(stored, { utm_source: 'facebook', fbclid: 'ABC' })).toBe(true)
  })

  it('lets a newer campaign replace an older one', () => {
    const stored = { utm_campaign: 'july' }
    expect(shouldOverwriteAttribution(stored, { utm_campaign: 'august' })).toBe(true)
  })

  it('never stores an empty attribution over nothing', () => {
    expect(shouldOverwriteAttribution(null, {})).toBe(false)
  })
})

describe('parseAttribution', () => {
  it('round-trips a serialized attribution', () => {
    const attr = { utm_source: 'facebook', fbclid: 'ABC' }
    expect(parseAttribution(serializeAttribution(attr))).toEqual(attr)
  })

  it('returns null for junk rather than throwing', () => {
    for (const bad of ['', 'not json', '[]', 'null', '{"utm_source":123}', undefined, null]) {
      expect(parseAttribution(bad as string)).toBeNull()
    }
  })

  it('drops keys outside the allowlist', () => {
    expect(parseAttribution('{"utm_source":"ig","admin":true,"role":"owner"}')).toEqual({ utm_source: 'ig' })
  })

  it('survives a truncated cookie', () => {
    expect(parseAttribution('{"utm_source":"faceb')).toBeNull()
  })
})
