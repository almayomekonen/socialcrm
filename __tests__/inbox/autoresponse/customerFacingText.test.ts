import { describe, expect, it } from 'vitest'
import {
  finalizeCustomerFacingText,
  hasCustomerFacingDash,
  normalizeCustomerFacingText,
} from '@/lib/inbox/autoresponse/customerFacingText'
import { handoffMessage, deterministicQualifyFallback } from '@/lib/inbox/autoresponse/qualify'
import { DEFER_VARIANTS, deferLine } from '@/lib/inbox/autoresponse/postHandoff'
import { postHandoffStatusMessage } from '@/lib/inbox/autoresponse/postHandoffPolicy'

describe('normalizeCustomerFacingText', () => {
  it('G: rewrites an em dash clause without concatenating words', () => {
    const out = normalizeCustomerFacingText('הלידים מרוכזים במקום אחד — כך קל לעקוב.')
    expect(out).toBe('הלידים מרוכזים במקום אחד, כך קל לעקוב.')
    expect(hasCustomerFacingDash(out)).toBe(false)
  })

  it('rewrites a second production-style em dash clause', () => {
    const out = normalizeCustomerFacingText('SocialCRM מרכזת לידים — עם סטטוס ומעקב.')
    expect(out).toBe('SocialCRM מרכזת לידים, עם סטטוס ומעקב.')
    expect(hasCustomerFacingDash(out)).toBe(false)
  })

  it('rewrites glued em dashes and Hebrew-to-Latin hyphens', () => {
    expect(hasCustomerFacingDash(normalizeCustomerFacingText('למי לחזור—ככה פניות לא נופלות.'))).toBe(false)
    expect(normalizeCustomerFacingText('מתחילים בחיבור הוואטסאפ העסקי ל-SocialCRM.')).toBe(
      'מתחילים בחיבור הוואטסאפ העסקי לSocialCRM.',
    )
    expect(normalizeCustomerFacingText('מתחילים בחיבור הוואטסאפ העסקי ל‑SocialCRM.')).toBe(
      'מתחילים בחיבור הוואטסאפ העסקי לSocialCRM.',
    )
  })

  it('mixed punctuation still ends with zero customer-facing dashes', () => {
    const out = finalizeCustomerFacingText('הלידים במקום אחד — עם סטטוס, מעקב – ותזכורות.')
    expect(hasCustomerFacingDash(out)).toBe(false)
    expect(out).toContain('הלידים במקום אחד')
    expect(out).toContain('עם סטטוס')
  })

  it('leaves phones, URLs, emails, and IDs untouched', () => {
    const phone = '+972-52-418-6300'
    const url = 'https://getsocialcrm.com/leads/a-b'
    const email = 'help@social-crm.example'
    const uuid = 'c087a0f5-99e2-1f4d-fa78-fd0ea2ee379e'
    const wamid = 'wamid.HBgMOTcyNTI0MTg2MzAw-FQIA'
    expect(normalizeCustomerFacingText(phone)).toBe(phone)
    expect(normalizeCustomerFacingText(url)).toBe(url)
    expect(normalizeCustomerFacingText(email)).toBe(email)
    expect(normalizeCustomerFacingText(uuid)).toBe(uuid)
    expect(normalizeCustomerFacingText(wamid)).toBe(wamid)
    const mixed = `אפשר לפנות באימייל ${email} או בקישור ${url} במספר ${phone}. הלידים במקום אחד — כך קל לעקוב.`
    const out = normalizeCustomerFacingText(mixed)
    expect(out).toContain(email)
    expect(out).toContain(url)
    expect(out).toContain(phone)
    expect(hasCustomerFacingDash(out)).toBe(false)
    expect(out).toContain('הלידים במקום אחד, כך קל לעקוב.')
  })

  it('I: handoff copy has no dash after finalize', () => {
    const he = finalizeCustomerFacingText(handoffMessage('human_request', 'he'))
    const en = finalizeCustomerFacingText(handoffMessage('human_request', 'en'))
    expect(hasCustomerFacingDash(he)).toBe(false)
    expect(hasCustomerFacingDash(en)).toBe(false)
  })

  it('H: product fallback has no dash after finalize', () => {
    const he = finalizeCustomerFacingText(
      deterministicQualifyFallback({
        qualification: { need: 'ניהול לידים' },
        lastInboundText: 'איך זה עובד',
        lang: 'he',
        salesMove: 'PRODUCT_QUESTION',
        salesStrategy: 'how_it_works',
      }),
    )
    const en = finalizeCustomerFacingText(
      deterministicQualifyFallback({
        qualification: { need: 'lead management' },
        lastInboundText: 'how does it work',
        lang: 'en',
        salesMove: 'PRODUCT_QUESTION',
        salesStrategy: 'how_it_works',
      }),
    )
    expect(hasCustomerFacingDash(he)).toBe(false)
    expect(hasCustomerFacingDash(en)).toBe(false)
  })

  it('post-handoff status and defer lines have no dash', () => {
    expect(hasCustomerFacingDash(finalizeCustomerFacingText(postHandoffStatusMessage('he')))).toBe(false)
    expect(hasCustomerFacingDash(finalizeCustomerFacingText(postHandoffStatusMessage('en')))).toBe(false)
    for (let i = 0; i < DEFER_VARIANTS.length; i++) {
      expect(hasCustomerFacingDash(finalizeCustomerFacingText(deferLine(i)))).toBe(false)
    }
  })
})
