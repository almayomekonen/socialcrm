import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { LIST_ROWS, NOW, THREAD } from './inboxEnv'

/**
 * HEBREW BASELINE — `/inbox` LABEL PRODUCERS, as data: every pure function and
 * constant the desktop WhatsApp inbox reads its copy from. Recorded BEFORE the
 * Phase D inbox package; Hebrew (the default, with no locale argument) must
 * stay identical afterwards. Screens: inboxHebrewBaseline*.test.tsx.
 */

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())

const HOUR = 3_600_000

describe('Hebrew baseline — inbox label producers', () => {
  test('intelligence labels, channel labels', async () => {
    const intel = await import('@/modules/inbox/intelLabels')
    const channels = await import('@/modules/inbox/channels')
    expect({
      INTENT_LABELS: intel.INTENT_LABELS,
      TEMPERATURE_BADGES: intel.TEMPERATURE_BADGES,
      ACTION_LABELS: intel.ACTION_LABELS,
      CONFIDENCE_LABELS: intel.CONFIDENCE_LABELS,
      whatsapp: channels.channelLabel('whatsapp'),
      unknown: channels.channelLabel('telegram'),
    }).toMatchSnapshot()
  })

  test('WhatsApp error copy: every Meta code group, every persisted category, unknown keys, tooltips', async () => {
    const e = await import('@/lib/inbox/whatsappErrorCopy')
    const codes = [470, 131047, 131051, 131026, 131052, 131031, 131042, 131049, 141006, 999, null, undefined]
    const keys = ['window_expired', 'recipient', 'account', 'generic', 'future_key', null, '']
    expect({
      mapWhatsappError: codes.map((c) => [c ?? String(c), e.mapWhatsappError(c)]),
      failureTextForCategory: keys.map((k) => [String(k), e.failureTextForCategory(k)]),
      failureTooltip: keys.map((k) => [String(k), e.failureTooltip(k)]),
      normalize: keys.map((k) => [String(k), e.normalizeFailureCategory(k)]),
    }).toMatchSnapshot()
  })

  test('thread view: bodies, quotes (every type word), entries; attachment labels', async () => {
    const v = await import('@/lib/inbox/whatsappThreadView')
    const a = await import('@/lib/inbox/attachmentDisplay')
    const base = { id: 1, direction: 'inbound', text: '', timestamp: '', status: 'received', failureText: null, failureCategory: null, attachment: null }
    const types = ['image', 'video', 'document', 'audio', 'sticker', 'location', 'contacts', 'interactive', 'text']
    const mimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/png',
      'audio/ogg',
      'video/mp4',
      'application/zip',
      'text',
      null,
    ]
    expect({
      QUOTE_NOT_FOUND: v.QUOTE_NOT_FOUND,
      quotePreview: types.map((type) => [type, v.quotePreview({ ...base, type } as never)]),
      quoteNamedDoc: v.quotePreview({ ...base, type: 'document', attachment: { filename: 'a.pdf', mimeType: 'application/pdf' } } as never),
      messageBody: types.map((type) => [type, v.messageBody({ ...base, type } as never)]),
      entries: v.buildThreadEntries(THREAD as never).map((e) => (e.kind === 'message' ? [e.key, e.quote, e.reactions] : [e.key, e.emoji, e.byBusiness])),
      UNSUPPORTED_MESSAGE_NOTICE: a.UNSUPPORTED_MESSAGE_NOTICE,
      UNNAMED_ATTACHMENT_LABEL: a.UNNAMED_ATTACHMENT_LABEL,
      UNNAMED_AUDIO_LABEL: a.UNNAMED_AUDIO_LABEL,
      fileKindLabel: mimes.map((m) => [String(m), a.fileKindLabel(m)]),
    }).toMatchSnapshot()
  })

  test('composer decision copy and the health notices it shows', async () => {
    const d = await import('@/lib/inbox/whatsappComposerDecision')
    const c = await import('@/lib/connections/messages')
    const healths = ['disconnected', 'unknown', 'throttled', 'token', 'webhook', 'registration_pending', 'restricted', 'inbound_only', 'operational'] as const
    expect({
      SERVICE_WINDOW_COPY: d.SERVICE_WINDOW_COPY,
      notices: healths.map((h) => [h, d.noticeForComposerHealth(h)]),
      reasonsLabel: c.SHARED.reasonsLabel,
    }).toMatchSnapshot()
  })

  test('waiting copy and list rows (real mapper)', async () => {
    const w = await import('@/lib/inbox/waitingReplyCopy')
    const { mapInboxRow } = await import('@/modules/inbox/mapInboxRow')
    const samples = [0.5, 30, 90, 5 * 60, 23 * 60, 25 * 60, 49 * 60, 24 * 60 - 0.4].map((minutes) => {
      const copy = w.waitingReplyCopy({ lastInboundAt: NOW - minutes * 60_000, lastHumanOutboundAt: null, nowMs: NOW })
      return [minutes, copy, copy ? w.inboxWaitingTitle(copy) : null]
    })
    expect({
      samples,
      replied: w.waitingReplyCopy({ lastInboundAt: NOW - 2 * HOUR, lastHumanOutboundAt: NOW - HOUR, nowMs: NOW }),
      rows: LIST_ROWS.map((r) => mapInboxRow(r, NOW)),
    }).toMatchSnapshot()
  })
})
