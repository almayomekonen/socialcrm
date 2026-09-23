/**
 * Messenger pure rules: event parsing (tenancy, echoes, attachments), the
 * 24-hour window, Send API error mapping, and the lead source key.
 */
import { describe, expect, it } from 'vitest'
import { echoSource, parseMessagingEvent,
  messengerEventKey,
} from '@/lib/facebook/messenger/parseMessagingEvent'
import {
  MESSENGER_WINDOW_MS,
  messengerLeadSource,
  messengerWindow,
  messengerWindowHint,
  sendFailureFromGraph,
} from '@/lib/facebook/messenger/rules'
import type { MetaGraphError } from '@/lib/facebook/graphClient'

const PAGE = '111'
const PSID = '999'

const inbound = (message: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  sender: { id: PSID },
  recipient: { id: PAGE },
  timestamp: 1_790_000_000_000,
  message: { mid: 'm1', ...message },
  ...over,
})

describe('parseMessagingEvent', () => {
  it('inbound text: PSID is the sender, Page is the verified entry id', () => {
    expect(parseMessagingEvent(PAGE, inbound({ text: 'היי' }))).toEqual({
      kind: 'inbound',
      pageId: PAGE,
      psid: PSID,
      mid: 'm1',
      text: 'היי',
      attachments: [],
      timestamp: new Date(1_790_000_000_000),
      quickReplyPayload: null,
    })
  })

  it('a quick-reply tap is an ordinary inbound message that also carries its payload', () => {
    const e = parseMessagingEvent(PAGE, inbound({ text: 'כן', quick_reply: { payload: 'YES_PLEASE' } }))
    expect(e).toMatchObject({ kind: 'inbound', text: 'כן', quickReplyPayload: 'YES_PLEASE' })
  })

  it('echo: PSID is the RECIPIENT, and the app id is carried for source labelling', () => {
    const e = parseMessagingEvent(PAGE, {
      sender: { id: PAGE },
      recipient: { id: PSID },
      timestamp: 1,
      message: { is_echo: true, app_id: 42, mid: 'm2', text: 'x' },
    })
    expect(e).toMatchObject({ kind: 'echo', psid: PSID, appId: '42' })
  })

  it('an event naming a different Page than the signed entry is dropped', () => {
    expect(parseMessagingEvent(PAGE, inbound({ text: 'x' }, { recipient: { id: '222' } }))).toEqual({
      kind: 'ignored',
      reason: 'wrong_page',
    })
    expect(
      parseMessagingEvent(PAGE, { sender: { id: '222' }, recipient: { id: PSID }, message: { is_echo: true, mid: 'm' } }),
    ).toEqual({ kind: 'ignored', reason: 'wrong_page' })
  })

  it('a read receipt is its own kind, never a message (it must not move the send window)', () => {
    expect(
      parseMessagingEvent(PAGE, { sender: { id: PSID }, recipient: { id: PAGE }, read: { watermark: 1_790_000_000_000 } }),
    ).toEqual({ kind: 'read', pageId: PAGE, psid: PSID, timestamp: null, watermark: new Date(1_790_000_000_000) })
  })

  it('a delivery receipt carries the watermark and any mids Meta listed', () => {
    expect(
      parseMessagingEvent(PAGE, {
        sender: { id: PSID },
        recipient: { id: PAGE },
        delivery: { watermark: 1_790_000_000_000, mids: ['m1', 'm2'] },
      }),
    ).toMatchObject({ kind: 'delivery', psid: PSID, watermark: new Date(1_790_000_000_000), mids: ['m1', 'm2'] })
  })

  it('a watermark that is not a usable timestamp is dropped rather than stamped as now()', () => {
    for (const bad of [0, -1, 'x', null, undefined, Number.NaN]) {
      expect(parseMessagingEvent(PAGE, { sender: { id: PSID }, read: { watermark: bad } })).toMatchObject({
        kind: 'ignored',
      })
    }
  })

  it('postback, referral and reaction each parse to their own kind', () => {
    expect(
      parseMessagingEvent(PAGE, { sender: { id: PSID }, postback: { title: 'התחל', payload: 'GET_STARTED' } }),
    ).toMatchObject({ kind: 'postback', title: 'התחל', payload: 'GET_STARTED' })
    expect(
      parseMessagingEvent(PAGE, { sender: { id: PSID }, referral: { ref: 'promo7', source: 'ADS', type: 'OPEN_THREAD' } }),
    ).toMatchObject({ kind: 'referral', ref: 'promo7', source: 'ADS', refType: 'OPEN_THREAD' })
    expect(
      parseMessagingEvent(PAGE, { sender: { id: PSID }, reaction: { action: 'react', emoji: '❤', mid: 'm9' } }),
    ).toMatchObject({ kind: 'reaction', action: 'react', emoji: '❤', targetMid: 'm9' })
  })

  it('a non-message event sent BY the Page is not treated as a customer signal', () => {
    expect(parseMessagingEvent(PAGE, { sender: { id: PAGE }, read: { watermark: 1_790_000_000_000 } })).toEqual({
      kind: 'ignored',
      reason: 'not_a_message',
    })
  })

  it('dedupe keys are stable per event and differ across events', () => {
    const read = parseMessagingEvent(PAGE, { sender: { id: PSID }, read: { watermark: 1_790_000_000_000 } })
    const again = parseMessagingEvent(PAGE, { sender: { id: PSID }, read: { watermark: 1_790_000_000_000 } })
    const later = parseMessagingEvent(PAGE, { sender: { id: PSID }, read: { watermark: 1_790_000_009_999 } })
    expect(messengerEventKey(read)).toBe(messengerEventKey(again))
    expect(messengerEventKey(read)).not.toBe(messengerEventKey(later))
    expect(messengerEventKey({ kind: 'ignored', reason: 'malformed' })).toBeNull()
  })

  it('never throws on hostile input', () => {
    for (const bad of [null, undefined, 1, 'x', [], { message: 'x' }, { message: { mid: 'm' } }]) {
      expect(() => parseMessagingEvent(PAGE, bad)).not.toThrow()
      expect(parseMessagingEvent(PAGE, bad).kind).toBe('ignored')
    }
    expect(parseMessagingEvent('', inbound({ text: 'x' })).kind).toBe('ignored')
  })

  it('attachments: displayable types keep an https URL; everything else becomes an explicit unsupported marker', () => {
    const e = parseMessagingEvent(
      PAGE,
      inbound({
        attachments: [
          { type: 'image', payload: { url: 'https://lookaside.fbsbx.com/x.jpg' } },
          { type: 'file', payload: { url: 'http://insecure.example/x.pdf' } },
          { type: 'template', payload: { template_type: 'generic' } },
          { type: 'fallback', payload: { url: 'https://example.com' } },
        ],
      }),
    )
    expect(e.kind === 'inbound' && e.attachments).toEqual([
      { type: 'image', url: 'https://lookaside.fbsbx.com/x.jpg' },
      // http:// is not kept: it is not something we will render or link to.
      { type: 'file', url: null },
      // A template/fallback is SHARED CONTENT, not an unrenderable blob. Saying
      // "unsupported" would hide from the rep that the customer sent a link.
      { type: 'share', url: null, title: null },
      { type: 'share', url: 'https://example.com', title: null },
    ])
  })

  it('a sticker is flagged so the thread can render it as a sticker, not as a photo', () => {
    const e = parseMessagingEvent(
      PAGE,
      inbound({ attachments: [{ type: 'image', payload: { url: 'https://cdn.example/s.png', sticker_id: 369239263222822 } }] }),
    )
    expect(e.kind === 'inbound' && e.attachments).toEqual([
      { type: 'image', url: 'https://cdn.example/s.png', sticker: true },
    ])
  })

  it('a genuinely unknown attachment type is still kept with an explicit marker', () => {
    const e = parseMessagingEvent(PAGE, inbound({ attachments: [{ type: 'location', payload: {} }] }))
    expect(e.kind === 'inbound' && e.attachments).toEqual([{ type: 'unsupported', url: null }])
  })

  it('echo source: our app, the Page inbox (both documented id forms), or another app', () => {
    expect(echoSource('APP', 'APP')).toBe('socialcrm')
    expect(echoSource('263902037430900', 'APP')).toBe('page_inbox')
    expect(echoSource('26390203743090', 'APP')).toBe('page_inbox')
    expect(echoSource('777', 'APP')).toBe('other_app')
    expect(echoSource(null, 'APP')).toBe('other_app')
  })
})

describe('24-hour standard messaging window', () => {
  const last = new Date('2026-09-14T10:00:00Z')

  it('open until exactly 24 hours after the customer\'s last message, then closed', () => {
    expect(messengerWindow(last, new Date(last.getTime() + MESSENGER_WINDOW_MS - 1)).open).toBe(true)
    expect(messengerWindow(last, new Date(last.getTime() + MESSENGER_WINDOW_MS)).open).toBe(false)
    expect(messengerWindow(last, new Date(last.getTime() + MESSENGER_WINDOW_MS)).closesAt).toEqual(
      new Date('2026-09-15T10:00:00Z'),
    )
  })

  it('no inbound message → closed (fail-closed: SocialCRM never sends first)', () => {
    expect(messengerWindow(null, new Date())).toEqual({ open: false, closesAt: null })
    expect(messengerWindow('not a date', new Date())).toEqual({ open: false, closesAt: null })
  })

  it('the hint is relative (no timezone), and absent when closed', () => {
    expect(messengerWindowHint(messengerWindow(last, new Date('2026-09-14T13:30:00Z')), new Date('2026-09-14T13:30:00Z'))).toBe(
      'אפשר להשיב עוד כ-20 שעות',
    )
    expect(messengerWindowHint(messengerWindow(last, new Date('2026-09-15T09:30:00Z')), new Date('2026-09-15T09:30:00Z'))).toBe(
      'חלון המענה ייסגר בפחות משעה',
    )
    expect(messengerWindowHint(messengerWindow(last, new Date('2026-09-16T00:00:00Z')), new Date('2026-09-16T00:00:00Z'))).toBeNull()
  })
})

describe('Send API errors → actionable reasons', () => {
  const g = (code: number | null, subcode: number | null = null, status = 400): MetaGraphError => ({
    kind: 'graph',
    status,
    code,
    subcode,
    type: null,
    message: null,
  })

  it.each([
    [g(190), 'reconnect_required'],
    [g(10, 2018278), 'window_closed'],
    [g(551, 1545041), 'recipient_unavailable'],
    [g(100, 2018001), 'recipient_unavailable'],
    [g(613), 'rate_limited'],
    [g(10), 'permission_missing'],
    [g(200), 'permission_missing'],
    [g(1), 'meta_error'],
  ] as const)('%o → %s', (error, reason) => {
    expect(sendFailureFromGraph(error)).toBe(reason)
  })

  it('network and timeout failures are Meta errors, not permission problems', () => {
    expect(sendFailureFromGraph({ ...g(null), kind: 'timeout', status: 0 })).toBe('meta_error')
  })
})

describe('lead source', () => {
  it('is the conversation key: agency + Page + PSID (a PSID means nothing outside its Page)', () => {
    expect(messengerLeadSource(103, 'P1', 'S1')).toBe('messenger:103:P1:S1')
    expect(messengerLeadSource(103, 'P2', 'S1')).not.toBe(messengerLeadSource(103, 'P1', 'S1'))
    expect(messengerLeadSource(104, 'P1', 'S1')).not.toBe(messengerLeadSource(103, 'P1', 'S1'))
  })
})
