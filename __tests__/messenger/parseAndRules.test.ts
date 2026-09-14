/**
 * Messenger pure rules: event parsing (tenancy, echoes, attachments), the
 * 24-hour window, Send API error mapping, and the lead source key.
 */
import { describe, expect, it } from 'vitest'
import { echoSource, parseMessagingEvent } from '@/lib/facebook/messenger/parseMessagingEvent'
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
    })
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

  it('reads, deliveries and postbacks are not messages', () => {
    expect(parseMessagingEvent(PAGE, { sender: { id: PSID }, recipient: { id: PAGE }, read: { watermark: 1 } })).toMatchObject({
      kind: 'ignored',
      reason: 'not_a_message',
    })
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
      { type: 'file', url: null },
      { type: 'unsupported', url: null },
      { type: 'unsupported', url: 'https://example.com' },
    ])
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
