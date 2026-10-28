import { describe, expect, test } from 'vitest'
import { createTranslator } from '@/lib/i18n/translate'
import { CATALOGS } from '@/lib/i18n/messages'

const he = createTranslator('he', CATALOGS.he)
const en = createTranslator('en', CATALOGS.en)
const ar = createTranslator('ar', CATALOGS.ar)

describe('translator', () => {
  test('plain lookup per locale', () => {
    expect(he('shell.nav.leads')).toBe('לידים')
    expect(en('shell.nav.leads')).toBe('Leads')
    expect(ar('shell.nav.leads')).toBe('العملاء المحتملون')
  })

  test('interpolation fills whole-sentence messages', () => {
    expect(en('language.useAgencyDefault', { language: 'English' })).toBe('Business default (English)')
    expect(he('language.useAgencyDefault', { language: 'עברית' })).toBe('ברירת המחדל של העסק (עברית)')
  })

  test('English plurals', () => {
    expect(en('shell.trialPill', { count: 1 })).toBe('PRO · 1 day left')
    expect(en('shell.trialPill', { count: 5 })).toBe('PRO · 5 days left')
  })

  test('Hebrew plurals reproduce the pre-i18n strings', () => {
    expect(he('shell.trialPill', { count: 1 })).toBe('PRO · נותר יום')
    expect(he('shell.trialPill', { count: 2 })).toBe('PRO · נותרו 2 ימים')
    expect(he('shell.trialPill', { count: 7 })).toBe('PRO · נותרו 7 ימים')
  })

  test('Arabic uses its six plural categories', () => {
    expect(ar('shell.trialPill', { count: 0 })).toBe('PRO · لم يتبقَّ أي يوم')
    expect(ar('shell.trialPill', { count: 1 })).toBe('PRO · تبقّى يوم واحد')
    expect(ar('shell.trialPill', { count: 2 })).toBe('PRO · تبقّى يومان')
    expect(ar('shell.trialPill', { count: 5 })).toBe('PRO · تبقّت 5 أيام')
    expect(ar('shell.trialPill', { count: 11 })).toBe('PRO · تبقّى 11 يومًا')
    expect(ar('shell.trialPill', { count: 100 })).toBe('PRO · تبقّى 100 يوم')
  })

  test('numbers are locale-formatted; Arabic keeps Latin digits like the rest of the CRM data', () => {
    expect(en('shell.notifications.unread', { count: 1234 })).toBe('Notifications, 1,234 new')
    expect(ar('shell.notifications.unread', { count: 5 })).toContain('5')
    expect(ar('shell.notifications.unread', { count: 5 })).not.toContain('٥')
  })

  test('a missing key returns the key, visibly, not another language', () => {
    expect(en('shell.nav.nope' as any)).toBe('shell.nav.nope')
  })

  test('translator reports its locale', () => {
    expect(ar.locale).toBe('ar')
  })
})
