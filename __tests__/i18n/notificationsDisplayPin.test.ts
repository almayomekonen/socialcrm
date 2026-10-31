import { describe, expect, test } from 'vitest'
import { NOTIFICATION_REGISTRY } from '@/lib/notifications/registry'
import { NOTIFICATION_CATEGORIES, NOTIFICATION_TYPES, type NotificationPayload, type NotificationType } from '@/lib/notifications/types'
import { CATEGORY_LABEL, bellLabel } from '@/modules/notifications/dropdown'
import { BODY_FORMS, TITLE_FORMS, VERBATIM_TYPES, categoryLabelIn, matchStoredText, storedTextIn } from '@/modules/notifications/display'
import { translatorFor } from '@/lib/i18n/translators'
import { bellLabelFor } from '@/components/notifications/NotificationBell'
import { ctxFor } from './notificationsEnv'

/**
 * Phase F3 pins: the read-time wording of stored notifications against the
 * EMITTERS' OWN copy functions (NOTIFICATION_REGISTRY[type].title / body), for
 * every type and every shape each can write. For each: the stored text is
 * recognised, the Hebrew catalog with the values read back reproduces it byte
 * for byte, Hebrew display is the stored text itself, and en / ar word it with
 * the data (names, counts) exactly as stored. A new type, or a new shape of an
 * existing one, fails here until it is mapped or listed as verbatim.
 */

const NAMES = ['יוסי לוי', 'Almayo Mekonen', 'דנה — כהן', 'O’Neil 2', ' רונית ', 'מיכל (אמא)']

/** Every payload shape the registry's copy branches on, per type. */
function shapes(type: NotificationType): { payload: NotificationPayload; groupCount: number }[] {
  const named = [{}, ...NAMES.map((leadName) => ({ leadName }))]
  const one = (payload: NotificationPayload) => ({ payload, groupCount: 1 })
  switch (type) {
    case 'lead.questionnaire_handoff':
      return named.flatMap((p) => [one({ ...p, complete: true }), one({ ...p, complete: false })])
    case 'lead.bulk_assigned':
      return [0, 1, 2, 3, 11, 100, 1000, -1, null].map((assignedCount) => one({ assignedCount }))
    case 'message.inbound_multiple':
    case 'message.messenger_inbound':
      return named.flatMap((p) => [1, 2, 3, 10, 1500].map((groupCount) => ({ payload: p, groupCount })))
    case 'integration.disconnected':
    case 'integration.error':
    case 'integration.ingestion_failed':
      return ['facebook', 'whatsapp', null, ''].map((provider) => one({ provider }))
    case 'subscription.cancellation_requested':
      return [null, '', 'סטודיו נגה', 'Acme Ltd'].map((cancellingAgencyName) => one({ cancellingAgencyName }))
    default:
      return named.map(one)
  }
}

const he = translatorFor('he')

describe('every registered type is mapped or deliberately verbatim', () => {
  test('the registry and the mapping table agree', () => {
    for (const type of NOTIFICATION_TYPES) {
      const mapped = Boolean(TITLE_FORMS[type])
      expect(mapped !== VERBATIM_TYPES.includes(type), type).toBe(true)
    }
    expect(VERBATIM_TYPES.every((t) => NOTIFICATION_REGISTRY[t].enabled === false)).toBe(true)
  })
})

describe('per type: the emitter text is recognised and re-rendered exactly', () => {
  for (const type of NOTIFICATION_TYPES.filter((t) => TITLE_FORMS[t])) {
    test(type, () => {
      const def = NOTIFICATION_REGISTRY[type]
      for (const { payload, groupCount } of shapes(type)) {
        const ctx = ctxFor(type, payload, groupCount)
        for (const field of ['title', 'body'] as const) {
          const stored = def[field](ctx)
          if (stored === null) {
            expect(storedTextIn({ type, title: 'x', body: null }, 'body', 'en')).toBeNull()
            continue
          }
          const item = { type, title: field === 'title' ? stored : 'x', body: field === 'body' ? stored : null }
          // Hebrew: the stored text itself, always.
          expect(storedTextIn(item, field, 'he')).toEqual({ text: stored, verbatim: false })
          const match = matchStoredText(type, field, stored)
          expect(match, `${type} ${field}: ${stored}`).not.toBeNull()
          // The Hebrew catalog sentence with the values read back IS the emitter's text.
          expect(he(match!.key, match!.params), `${type} ${field}`).toBe(stored)
          for (const locale of ['en', 'ar'] as const) {
            const shown = storedTextIn(item, field, locale)!
            expect(shown.verbatim, `${type} ${field} [${locale}]`).toBe(false)
            // Data is carried over exactly as stored, never translated.
            const given = (payload.leadName ?? payload.cancellingAgencyName ?? '').trim()
            const name = given && stored.includes(given) ? given : ''
            if (name) expect(shown.text).toContain(name)
            // …and nothing else in it is Hebrew.
            expect(name ? shown.text.split(name).join('') : shown.text).not.toMatch(/[֐-׿]/)
          }
        }
      }
    })
  }
})

describe('fallbacks: shown as stored, inside a Hebrew region', () => {
  test('a provider the catalog does not know (the emitter prints its raw key)', () => {
    for (const type of ['integration.disconnected', 'integration.error'] as const) {
      const stored = NOTIFICATION_REGISTRY[type].title(ctxFor(type, { provider: 'tiktok' }))
      expect(storedTextIn({ type, title: stored, body: null }, 'title', 'en')).toEqual({ text: stored, verbatim: true })
    }
    const body = NOTIFICATION_REGISTRY['integration.ingestion_failed'].body(ctxFor('integration.ingestion_failed', { provider: 'tiktok' }))!
    expect(storedTextIn({ type: 'integration.ingestion_failed', title: 'x', body }, 'body', 'ar')).toEqual({ text: body, verbatim: true })
  })

  test('legacy wording, free text, a body on a type that writes none, the SLA placeholder', () => {
    const cases: [NotificationType, 'title' | 'body', string][] = [
      ['lead.created', 'title', 'ליד חדש: יוסי לוי'],
      ['message.messenger_inbound', 'title', 'הודעה חדשה ב-Messenger — רונית'],
      ['lead.hot', 'body', 'שלוש פניות בשבוע'],
      ['lead.created', 'title', 'ליד חדש — '],
      ['message.inbound_multiple', 'title', '02 הודעות חדשות'],
      ['sla.breached', 'title', 'SLA'],
      // The right sentence on the wrong type is not a match either.
      ['lead.hot', 'title', 'ליד חדש — יוסי לוי'],
    ]
    for (const [type, field, stored] of cases) {
      const item = { type, title: field === 'title' ? stored : 'x', body: field === 'body' ? stored : null }
      expect(matchStoredText(type, field, stored), stored).toBeNull()
      expect(storedTextIn(item, field, 'en'), stored).toEqual({ text: stored, verbatim: true })
      expect(storedTextIn(item, field, 'he'), stored).toEqual({ text: stored, verbatim: false })
    }
  })
})

describe('worded examples (en / ar)', () => {
  const row = (type: NotificationType, payload: NotificationPayload, groupCount = 1) => {
    const ctx = ctxFor(type, payload, groupCount)
    return { type, title: NOTIFICATION_REGISTRY[type].title(ctx), body: NOTIFICATION_REGISTRY[type].body(ctx) }
  }
  test('names stay as stored, counts keep their digits, providers are our words', () => {
    expect(storedTextIn(row('lead.created', { leadName: 'יוסי לוי' }), 'title', 'en')!.text).toBe('New lead — יוסי לוי')
    expect(storedTextIn(row('message.inbound_multiple', { leadName: 'רונית' }, 4), 'title', 'en')!.text).toBe('4 new messages — רונית')
    expect(storedTextIn(row('message.inbound_multiple', {}, 11), 'title', 'ar')!.text).toBe('11 رسالة جديدة')
    expect(storedTextIn(row('lead.bulk_assigned', { assignedCount: 1000 }), 'title', 'en')!.text).toBe('1000 leads were assigned to you')
    expect(storedTextIn(row('lead.bulk_assigned', { assignedCount: 1 }), 'title', 'ar')!.text).toBe('تم إسناد عميل محتمل إليك')
    expect(storedTextIn(row('integration.disconnected', { provider: 'facebook' }), 'title', 'en')!.text).toBe('The Facebook connection was lost')
    expect(storedTextIn(row('integration.ingestion_failed', { provider: 'whatsapp' }), 'body', 'ar')!.text).toBe('وصل عميل محتمل من واتساب لم يُحفظ في النظام')
    expect(storedTextIn(row('subscription.cancellation_requested', { cancellingAgencyName: 'סטודיו נגה' }), 'body', 'en')!.text).toBe(
      'סטודיו נגה cancelled its SocialCRM subscription. Cancel its standing order in Grow.',
    )
    expect(storedTextIn(row('message.messenger_inbound', { leadName: 'Almayo Mekonen' }, 3), 'title', 'en')!.text).toBe(
      '3 new Messenger messages — Almayo Mekonen',
    )
  })
})

describe('category labels and the bell name', () => {
  test('Hebrew catalog = CATEGORY_LABEL (the registry of record); every category worded in en / ar', () => {
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(he(`notifications.category.${c}`)).toBe(CATEGORY_LABEL[c])
      expect(categoryLabelIn(c, 'he')).toBe(CATEGORY_LABEL[c])
      for (const l of ['en', 'ar'] as const) expect(categoryLabelIn(c, l)).not.toMatch(/[֐-׿]/)
    }
  })

  test('bellLabelFor (Phase A) still equals bellLabel in Hebrew for every threshold', () => {
    for (const n of [0, 1, 2, 3, 99, 100, 1500]) expect(bellLabelFor(he, n)).toBe(bellLabel(n))
  })
})
