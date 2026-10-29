import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { EVENTS, NOW } from './messengerCommentsEnv'

/**
 * HEBREW BASELINE — Messenger / Comments LABEL PRODUCERS, as data: every pure
 * function and constant these two inbox screens read copy from (event lines,
 * window hints, attachment-rule rejections, structured-content validation, the
 * Meta permission notices they show). Recorded BEFORE the Phase D
 * Messenger/Comments package; Hebrew (the default, no locale argument) must stay
 * identical afterwards. Screens: messengerCommentsHebrewBaseline*.test.tsx.
 */

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())

const HOUR = 3_600_000

describe('Hebrew baseline — Messenger / Comments label producers', () => {
  test('event lines: every postback / referral source / opt-in / reaction shape', async () => {
    const { describeMessengerEvent } = await import('@/modules/messenger/components/MessengerEventLine')
    const extra = [
      { kind: 'referral', title: 'MESSENGER_CODE', payload: null },
      { kind: 'referral', title: 'DISCOVER_TAB', payload: 'x' },
      { kind: 'referral', title: 'CUSTOMER_CHAT_PLUGIN', payload: null },
      { kind: 'referral', title: null, payload: 'ref1' },
    ].map((e, i) => ({ ...e, id: 100 + i, targetMessageId: null, occurredAt: new Date(NOW) }))
    const all = [...EVENTS, ...extra] as Parameters<typeof describeMessengerEvent>[0][]
    expect(all.map((e) => [e.kind, e.title, e.payload, describeMessengerEvent(e)])).toMatchSnapshot()
  })

  test('window and window hint; attachment rule rejections; structured validation; rich-content previews', async () => {
    const rules = await import('@/lib/facebook/messenger/rules')
    const att = await import('@/lib/facebook/messenger/attachmentRules')
    const s = await import('@/lib/facebook/messenger/structured')
    const now = new Date(NOW)
    const hint = (h: number | null) => rules.messengerWindowHint(rules.messengerWindow(h === null ? null : new Date(NOW - h * HOUR), now), now)
    const long = 'א'.repeat(90)
    const btn = (o: Record<string, unknown>) => ({ type: 'postback', title: 'כן', payload: 'Y', ...o })
    const cases = {
      quickTooMany: { quickReplies: Array.from({ length: 14 }, () => ({ title: 'a', payload: 'b' })) },
      quickNoTitle: { quickReplies: [{ title: '', payload: 'b' }] },
      quickLong: { quickReplies: [{ title: long, payload: 'b' }] },
      quickPayload: { quickReplies: [{ title: 'a', payload: 'p'.repeat(1001) }] },
      buttonsTooMany: { buttons: [btn({}), btn({}), btn({}), btn({})] },
      buttonNoTitle: { buttons: [btn({ title: '' })] },
      buttonLong: { buttons: [btn({ title: long })] },
      buttonUrl: { buttons: [{ type: 'web_url', title: 'קישור', url: 'http://x' }] },
      buttonPayload: { buttons: [btn({ payload: '' })] },
      cardsTooMany: { elements: Array.from({ length: 11 }, () => ({ title: 'a' })) },
      cardNoTitle: { elements: [{ title: '' }] },
      cardLong: { elements: [{ title: long }] },
      cardSubtitle: { elements: [{ title: 'a', subtitle: long }] },
      cardImage: { elements: [{ title: 'a', imageUrl: 'http://x' }] },
      cardButtons: { elements: [{ title: 'a', buttons: [btn({}), btn({}), btn({}), btn({})] }] },
      both: { buttons: [btn({})], elements: [{ title: 'a' }] },
      attachAndTemplate: { attachment: { type: 'image', url: 'https://cdn.test/a.png' }, buttons: [btn({})] },
      attachUrl: { attachment: { type: 'image', url: 'http://x' } },
      ok: {},
    }
    expect({
      hints: [null, 30, 23.5, 22.9, 20, 1, 0].map((h) => [h, hint(h)]),
      rejections: att.ATTACHMENT_REJECTION_COPY,
      checks: [
        { size: 0, type: 'text/plain', name: 'a.txt' },
        { size: 30 * 1024 * 1024, type: 'video/mp4', name: 'a.mp4' },
        { size: 10, type: 'application/x-msdownload', name: 'a.exe' },
        { size: 10, type: 'image/png', name: 'a.png' },
      ].map((f) => att.checkMessengerAttachment(f)),
      validation: Object.fromEntries(
        Object.entries(cases).map(([k, v]) => [k, s.validateRichContent(v as Parameters<typeof s.validateRichContent>[0])]),
      ),
      previews: [s.describeRichContent('', { elements: [{ title: 'a' }] } as never), s.describeRichContent('', { attachment: { type: 'image', url: 'https://x.y/a' } } as never), s.describeRichContent(' שלום ', {} as never)],
    }).toMatchSnapshot()
  })

  test('Meta notices shown on these routes, and the shared reasons label', async () => {
    const { FACEBOOK_NOTICES, SHARED } = await import('@/lib/connections/messages')
    const keys = ['messenger_permission', 'messenger_declined', 'messenger_not_subscribed', 'expired', 'comment_replies_permission', 'comment_replies_declined', 'in_app_browser']
    expect({ notices: Object.fromEntries(keys.map((k) => [k, FACEBOOK_NOTICES[k]])), reasonsLabel: SHARED.reasonsLabel }).toMatchSnapshot()
  })
})
