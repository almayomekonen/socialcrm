import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { translatorFor } from '@/lib/i18n/translators'
import { he } from '@/lib/i18n/messages/he'
import { AUTHOR_LABEL, CATEGORY_COPY, KIND_COPY, STATUS_COPY, supportErrorMessage } from '@/lib/support/copy'
import { GUIDE_ARTICLES } from '@/lib/support/knowledgeBase'
import { ARTICLE_KEYS } from '@/lib/support/articleKeys'
import { SUBJECT_FALLBACK } from '@/lib/support/derive'
import { authorLabels, categoryLabel, kindCopy, localizedArticle, searchArticlesIn, statusLabel, supportErrorText } from '@/lib/support/localizedCopy'
import { searchArticles } from '@/lib/support/knowledgeBase'
import { SUPPORT_CATEGORIES, SUPPORT_KINDS, SUPPORT_STATUSES } from '@/lib/support/vocabulary'
import { GENERIC_DISPLAY_NAME } from '@/lib/users/displayName'
import { validateCardHolder } from '@/lib/payments/cardTrial/cardHolder'
import { holderMessageText } from '@/components/trial/cardHolderMessage'

/**
 * Pins (i18n Phase F5): the Hebrew catalog holds the support centre's and the
 * trial gate's sentences VERBATIM from the constants they replaced or mirror,
 * every Hebrew producer returns the original value itself, the article key map
 * matches the registry's shape, and the server sentences mapped by exact match
 * still appear verbatim where they are produced.
 */

const HE = translatorFor('he')
const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, 'utf8')

describe('support centre', () => {
  test('statuses, categories, kinds, authors and errors: catalog Hebrew = lib/support/copy.ts', () => {
    for (const s of SUPPORT_STATUSES) {
      expect(he.support.status[s]).toBe(STATUS_COPY[s].label)
      expect(statusLabel(s)).toBe(STATUS_COPY[s].label)
      expect(statusLabel(s, 'en')).not.toBe(STATUS_COPY[s].label)
    }
    for (const c of SUPPORT_CATEGORIES) {
      expect(categoryLabel(c)).toBe(CATEGORY_COPY[c])
      expect(HE(c === 'other' ? 'support.category.otherTopic' : (`support.category.${c}` as never))).toBe(CATEGORY_COPY[c])
    }
    for (const k of SUPPORT_KINDS) {
      expect(he.support.kind[k]).toEqual(KIND_COPY[k])
      expect(kindCopy(k)).toBe(KIND_COPY[k])
    }
    expect(he.support.author).toEqual(AUTHOR_LABEL)
    expect(authorLabels()).toBe(AUTHOR_LABEL)
    for (const code of ['forbidden', 'not_found', 'invalid_subject', 'invalid_body', 'invalid_category', 'rate_limited', 'mystery'] as const) {
      expect(supportErrorText(code as never)).toBe(supportErrorMessage(code as never))
      expect(supportErrorText(code as never, 'en')).not.toMatch(/[֐-׿]/)
    }
    expect(he.support.error.fallback).toBe(supportErrorMessage('mystery' as never))
    expect(he.support.newRequest.title).toBe(SUBJECT_FALLBACK)
    expect(he.support.shell.genericName).toBe(GENERIC_DISPLAY_NAME)
  })

  test('every article: the key map has the registry shape; the Hebrew catalog holds its words verbatim', () => {
    expect(Object.keys(ARTICLE_KEYS).sort()).toEqual(GUIDE_ARTICLES.map((a) => a.slug).sort())
    for (const a of GUIDE_ARTICLES) {
      const keys = ARTICLE_KEYS[a.slug]
      expect(keys.sections.map((s) => s.body.length), a.slug).toEqual(a.sections.map((s) => s.body.length))
      expect(HE(keys.title)).toBe(a.title)
      expect(HE(keys.summary)).toBe(a.summary)
      a.sections.forEach((s, i) => {
        expect(HE(keys.sections[i].heading)).toBe(s.heading)
        s.body.forEach((p, j) => expect(HE(keys.sections[i].body[j])).toBe(p))
      })
      expect(localizedArticle(a)).toBe(a)
      // Outside Hebrew only the words change: slug, category, tags, integration and shape stay.
      const en = localizedArticle(a, 'en')
      expect({ ...en, title: 0, summary: 0, sections: en.sections.map((s) => s.body.length) }).toEqual({ ...a, title: 0, summary: 0, sections: a.sections.map((s) => s.body.length) })
      expect(JSON.stringify([en.title, en.summary, en.sections])).not.toMatch(/[֐-׿]/)
    }
  })

  test('search: Hebrew is searchArticles itself; other languages search their own words plus the tags', () => {
    for (const q of ['whatsapp', 'וואטסאפ', 'Excel', 'מנוי', '', 'zz']) {
      expect(searchArticlesIn(q).map((a) => a.slug)).toEqual(searchArticles(q).map((a) => a.slug))
    }
    expect(searchArticlesIn('Lead statuses', 'en').map((a) => a.slug)).toEqual(['lead-statuses'])
    expect(searchArticlesIn('וואטסאפ', 'en').map((a) => a.slug)).toEqual(searchArticles('וואטסאפ').map((a) => a.slug))
    expect(searchArticlesIn('', 'ar')).toHaveLength(GUIDE_ARTICLES.length)
  })

  test('the admin inbox keeps its own Hebrew copy (untouched)', () => {
    expect(read('lib/support/adminCopy.ts')).toContain("waiting_for_customer: { label: 'ממתינה ללקוח'")
  })
})

describe('trial gate and card return', () => {
  test("the holder refusals: catalog Hebrew = validateCardHolder's sentences, verbatim in the producers", () => {
    const name = validateCardHolder({ fullName: 'דנה', phone: '0501234567' }) as { message: string }
    const phone = validateCardHolder({ fullName: 'דנה כהן', phone: '1' }) as { message: string }
    expect(he.trial.holder.fullName).toBe(name.message)
    expect(he.trial.holder.phone).toBe(phone.message)
    expect(read('lib/payments/cardTrial/cardHolder.ts')).toContain(`'${he.trial.holder.fullName}'`)
    expect(read('lib/payments/cardTrial/cardHolder.ts')).toContain(`'${he.trial.holder.phone}'`)
    // startCardSetup's missing-previous-holder refusal is the same sentence.
    expect(read('lib/payments/cardTrial/startCardSetup.ts')).toContain(`'${he.trial.holder.fullName}'`)
    expect(holderMessageText(name.message, HE)).toBe(name.message)
    expect(holderMessageText(phone.message, translatorFor('en'))).toBe('Enter a valid Israeli mobile number, for example 0501234567')
    expect(holderMessageText('משהו אחר', translatorFor('ar'))).toBe('משהו אחר')
  })

  test('the moved Hebrew sentences are in the catalog, and gone from the components and pages', () => {
    expect(he.trial.welcome.title.setup).toBe('מתחילים עם 7 ימי ניסיון')
    expect(he.trial.expired.waiting.other).toBe('{count} לידים ממתינים לחזרה שלך')
    expect(he.trial.celebration.title).toBe('ה־Pro שלך פעיל')
    expect(he.trial.verifier.chargeOn).toBe('הכרטיס נשמר. החיוב הראשון, ₪{amount}, יתבצע ב־{date}. אפשר לבטל לפני כן בעמוד המנוי.')
    for (const f of [
      'components/trial/WelcomeTrialModal.tsx',
      'components/trial/welcomeTrialCopy.ts',
      'components/trial/TrialExpiredScreen.tsx',
      'components/trial/ProActivationSuccess.tsx',
      'components/trial/LeadEntryToasts.tsx',
      'components/billing/CardSetupVerifier.tsx',
      'app/billing/success/page.tsx',
      ...['SupportShell', 'SupportActions', 'SupportRequestForm', 'SupportReplyBox', 'SupportRequestList', 'SupportThread', 'SupportSearch', 'GuideArticle', 'GuideCategoryGrid'].map((c) => `components/support/${c}.tsx`),
      ...['layout', 'support/page', 'support/requests/page', 'support/new/page', 'support/requests/[requestId]/page', 'support/guides/page', 'support/guides/[slug]/page'].map((p) => `app/(support)/${p}.tsx`),
    ]) {
      // Only comments may still carry Hebrew.
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(code, f).not.toMatch(/[֐-׿]/)
    }
  })

  test('billing logic untouched: the verifier keeps its polling bounds and the page its redirect', () => {
    const verifier = read('components/billing/CardSetupVerifier.tsx')
    expect(verifier).toContain('const POLL_INTERVAL_MS = 2_000')
    expect(verifier).toContain('const MAX_WAIT_MS = 30_000')
    expect(read('app/billing/success/page.tsx')).toContain("redirect('/settings/update_payment')")
  })
})
