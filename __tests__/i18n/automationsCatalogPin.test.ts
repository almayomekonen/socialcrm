import { describe, expect, test, vi } from 'vitest'

/**
 * PIN: the Hebrew catalog words of the automations screens (Phase E5b) are the
 * product's own constants, letter for letter.
 *
 * Every producer returns the constant itself in Hebrew, so the Hebrew catalog
 * is never read at runtime — this test is what keeps it honest. It routes the
 * non-Hebrew path through the HEBREW catalog (translatorFor is mocked to read
 * it) and requires the result to equal the constant: catalog events, actions,
 * subjects, the integration, fields, options, parameters, requirement CTAs,
 * operators, skip / failure / accuracy / identity copy, timing phrases, the
 * sentence, the template catalog, every refusal map, the connections copy and
 * the connector's set-up guide.
 */

vi.mock('@/lib/i18n/translators', async () => {
  const { createTranslator } = await import('@/lib/i18n/translate')
  const { CATALOGS } = await import('@/lib/i18n/messages')
  return { translatorFor: (locale: 'he' | 'en' | 'ar') => createTranslator(locale, CATALOGS.he) }
})

const TIMINGS = [
  { kind: 'preset', preset: 'immediate' },
  { kind: 'preset', preset: 'one_hour' },
  { kind: 'preset', preset: 'one_day' },
  { kind: 'custom', value: 1, unit: 'hours' },
  { kind: 'custom', value: 2, unit: 'hours' },
  { kind: 'custom', value: 3, unit: 'days' },
  { kind: 'custom', value: 11, unit: 'days' },
  { kind: 'before_anchor', anchorField: 'startsAt', value: 1, unit: 'hours' },
  { kind: 'before_anchor', anchorField: 'startsAt', value: 2, unit: 'days' },
  { kind: 'before_anchor', anchorField: 'startsAt', value: 1, unit: 'days' },
] as never[]

describe('the Hebrew catalog equals the automations constants', () => {
  test('catalog entities, fields, options, parameters, requirements', async () => {
    const { catalog } = await import('@/lib/automations/catalog/registry')
    const i18n = await import('@/lib/automations/catalogI18n')
    for (const e of catalog.events) expect(i18n.localizeEvent(e, 'en'), e.key).toEqual(e)
    for (const a of catalog.actions) expect(i18n.localizeAction(a, 'en'), a.key).toEqual(a)
    for (const s of catalog.subjects) expect(i18n.localizeSubject(s, 'en'), s.key).toEqual(s)
    for (const i of catalog.integrations) expect(i18n.localizeIntegration(i, 'en'), i.key).toEqual(i)
    for (const e of catalog.events) expect(i18n.eventTitleIn(e.key, e.title, 'en')).toBe(e.title)
    for (const e of catalog.events) for (const f of e.fields) expect(i18n.fieldLabelIn(f.key, f.label, 'en'), f.key).toBe(f.label)
    expect(i18n.actionFallbackIn('en')).toBe('פעולה')
  })

  test('operators, skip / failure / accuracy / identity copy, timing, conditions, the sentence', async () => {
    const i18n = await import('@/lib/automations/catalogI18n')
    const copy = await import('@/lib/automations/copy')
    const { IDENTITY_PROBLEM_COPY } = await import('@/lib/automations/identity')
    const { OPERATOR_LABELS, describeCondition } = await import('@/lib/automations/conditions')
    const { automationSentence, timingPhrase } = await import('@/lib/automations/sentence')
    const { catalog } = await import('@/lib/automations/catalog/registry')
    for (const [op, he] of Object.entries(OPERATOR_LABELS)) expect(i18n.operatorLabelIn(op as never, 'en'), op).toBe(he)
    for (const [r, he] of Object.entries(copy.SKIP_REASON_COPY)) expect(i18n.skipReasonIn(r, 'en'), r).toBe(he)
    expect(i18n.skipReasonIn('mystery', 'en')).toBeUndefined()
    expect(i18n.failureIn('terminal', 'en')).toBe(copy.FAILURE_COPY.terminal)
    expect(i18n.failureIn('transient', 'en')).toBe(copy.FAILURE_COPY.transient)
    expect(i18n.timingAccuracyIn('en')).toBe(copy.TIMING_ACCURACY_COPY)
    for (const [p, he] of Object.entries(IDENTITY_PROBLEM_COPY)) expect(i18n.identityProblemIn(p, 'en'), p).toBe(he)
    for (const t of TIMINGS) expect(i18n.timingPhraseIn(t, 'en'), JSON.stringify(t)).toBe(timingPhrase(t))
    for (const event of catalog.events) {
      for (const field of event.fields) {
        for (const operator of ['is', 'exists'] as const) {
          const c = { field: field.key, operator, value: field.options?.[0]?.value ?? 'ערך חופשי' }
          expect(i18n.describeConditionIn(event, c, 'en'), `${event.key}.${field.key}`).toBe(describeCondition(event, c))
        }
      }
      const input = { event, conditions: [{ field: event.fields[0].key, operator: 'is' as const, value: 'x' }, { field: 'email', operator: 'exists' as const, value: '' }], actionTitle: 'שליחת אימייל', subject: 'נושא', timing: TIMINGS[5] }
      expect(i18n.automationSentenceIn(input, 'en'), event.key).toBe(automationSentence(input))
      expect(i18n.automationSentenceIn({ ...input, conditions: [], subject: '' }, 'en')).toBe(automationSentence({ ...input, conditions: [], subject: '' }))
    }
    const none = { event: null, conditions: [], actionTitle: 'פעולה', subject: '', timing: TIMINGS[0] }
    expect(i18n.automationSentenceIn(none, 'en')).toBe(automationSentence(none))
  })

  test('the template catalog, both category maps, every refusal map, the sheet timings', async () => {
    const { listTemplates } = await import('@/lib/automations/templates/registry')
    const { localizeTemplate, galleryCategoryIn } = await import('@/lib/automations/templateI18n')
    const tplCopy = await import('@/components/settings/templates/copy')
    const sheet = await import('@/components/settings/automations/sheetOptions')
    const conn = await import('@/components/settings/connections/copy')
    for (const t of listTemplates()) expect(localizeTemplate(t, 'en'), t.key).toEqual(t)
    for (const [c, he] of Object.entries(tplCopy.CATEGORY)) expect(galleryCategoryIn(c as never, he, 'en')).toBe(he)
    for (const r of [...Object.keys(tplCopy.ERRORS), 'subscription_required', 'other']) expect(tplCopy.errorMessageIn(r, 'en'), r).toBe(tplCopy.errorMessage(r))
    const sheetReasons = ['name_required', 'cta_url_invalid', 'template_missing', 'no_reply_to', 'parameter_invalid', 'unknown_variable', 'preview_failed', 'other']
    for (const r of sheetReasons) expect(sheet.errorMessageIn(r, 'en'), r).toBe(sheet.errorMessage(r))
    for (const r of [...Object.keys(conn.ERRORS), 'other']) expect(conn.errorMessageIn(r, 'en'), r).toBe(conn.errorMessage(r))
    for (const t of TIMINGS) expect(sheet.timingOptionsIn(t, 'en'), JSON.stringify(t)).toEqual(sheet.timingOptionsFor(t))
  })

  test('the connections copy, relative times and the set-up guide', async () => {
    const conn = await import('@/components/settings/connections/copy')
    for (const k of Object.keys(conn.HEALTH)) expect(conn.healthIn(k as never, 'en')).toEqual(conn.HEALTH[k as keyof typeof conn.HEALTH])
    for (const k of Object.keys(conn.SUBSCRIPTION)) expect(conn.subscriptionIn(k as never, 'en')).toEqual(conn.SUBSCRIPTION[k as keyof typeof conn.SUBSCRIPTION])
    for (const k of Object.keys(conn.STRATEGY)) expect(conn.strategyIn(k as never, 'en'), k).toEqual(conn.STRATEGY[k as keyof typeof conn.STRATEGY])
    for (const k of Object.keys(conn.DELIVERY)) expect(conn.deliveryIn(k as never, 'en'), k).toEqual(conn.DELIVERY[k as keyof typeof conn.DELIVERY])
    const now = Date.now()
    for (const ago of [null, 20_000, 5 * 60_000, 3 * 3_600_000, 30 * 3_600_000, 4 * 86_400_000, -60_000]) {
      const iso = ago === null ? null : new Date(now - ago).toISOString()
      expect(conn.timeAgoIn(iso, 'en'), String(ago)).toBe(conn.timeAgo(iso))
    }
    const { contactForm7Provider } = await import('@/lib/automations/connectors/contactForm7')
    for (const secret of [null, 'sec_1']) {
      const guide = contactForm7Provider.setup!({ webhookUrl: 'https://x.test/hook', secret })
      expect(conn.setupGuideIn(guide, 'en')).toEqual(guide)
    }
  })
})
