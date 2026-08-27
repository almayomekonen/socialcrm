import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  HISTORY_SYNC_DISABLED_CODE,
  historyDirection,
  parseHistoryValue,
  parseHistoryWebhook,
} from '@/lib/whatsapp/parseHistory'
import type { ParsedHistoryChunk, ParsedHistoryErrorEvent, ParsedHistoryMediaFollowup } from '@/lib/whatsapp/historyEvent'
import {
  BUSINESS_NUMBER,
  BUSINESS_PHONE_ID,
  CUSTOMER_A,
  CUSTOMER_B,
  HISTORY_CHUNK_VALUE,
  HISTORY_DEGRADED_VALUE,
  HISTORY_ERROR_VALUE,
  HISTORY_MEDIA_FOLLOWUP_VALUE,
  TS_A1,
  WAMID_A1,
  WAMID_A2,
  WAMID_A3,
  envelope,
} from './fixtures/historyPayloads'

/**
 * Wave 2A.2b — the parser, against Meta's published contract.
 *
 * These tests pin the CONTRACT, not an implementation: field names, the three
 * shapes, direction derivation, wamid and timestamp rejection, and the absence
 * of every side effect. Nothing here touches a database, a network, or a clock.
 */

const chunk = (v: unknown = HISTORY_CHUNK_VALUE) => parseHistoryValue(v) as ParsedHistoryChunk
const codeOf = (p: string) =>
  readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('official envelope', () => {
  it('T1: parses the documented entry[].changes[] envelope', () => {
    const events = parseHistoryWebhook(envelope(HISTORY_CHUNK_VALUE))
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('history_chunk')
    expect(events[0].phoneNumberId).toBe(BUSINESS_PHONE_ID)
    expect(events[0].displayPhoneNumber).toBe(BUSINESS_NUMBER)
  })

  it('T1b: reads ONLY changes whose field is history', () => {
    // A mixed delivery must not have its echoes read as archive content.
    expect(parseHistoryWebhook(envelope(HISTORY_CHUNK_VALUE, 'smb_message_echoes'))).toEqual([])
    expect(parseHistoryWebhook(envelope(HISTORY_CHUNK_VALUE, 'messages'))).toEqual([])
  })

  it('T1c: accepts the DECLINED shape, which Meta documents with no envelope', () => {
    expect(parseHistoryValue(HISTORY_ERROR_VALUE)?.kind).toBe('history_error')
  })
})

describe('threads and messages', () => {
  it('T2/T3: one event, multiple threads, keyed by the documented thread id', () => {
    expect(chunk().threads.map((t) => t.id)).toEqual([CUSTOMER_A, CUSTOMER_B])
  })

  it('T4: multiple messages per thread, in payload order', () => {
    expect(chunk().threads[0].messages.map((m) => m.externalId)).toEqual([WAMID_A1, WAMID_A2, WAMID_A3])
    expect(chunk().threads[1].messages).toHaveLength(1)
  })

  it('T18b: thread id is the customer identity, preserved verbatim', () => {
    const m = chunk().threads[0].messages[0]
    expect(m.threadId).toBe(CUSTOMER_A)
    expect(m.customerWaId).toBe(CUSTOMER_A)
  })
})

describe('chunk metadata', () => {
  it('T5/T6/T7: phase, chunk_order and progress are preserved', () => {
    const c = chunk()
    expect(c.phase).toBe(0)
    expect(c.chunkOrder).toBe(1)
    expect(c.progress).toBe(55)
  })

  it('T6b: chunkOrder is NOT the array index — it is Meta’s own ordering value', () => {
    // Chunks are documented to arrive out of order. This chunk is the only
    // entry in its payload (index 0) yet reports order 7.
    expect(chunk(HISTORY_DEGRADED_VALUE).chunkOrder).toBe(7)
    expect(chunk(HISTORY_DEGRADED_VALUE).phase).toBe(2)
  })

  it('T6c: the parser neither sorts nor merges chunks', () => {
    const src = codeOf('lib/whatsapp/parseHistory.ts')
    expect(src).not.toMatch(/\.sort\(|\.reverse\(/)
  })
})

describe('direction', () => {
  it('T8: a customer-originated message with no `to` is inbound', () => {
    const m = chunk().threads[0].messages[2]
    expect(m.from).toBe(CUSTOMER_A)
    expect(m.to).toBeNull()
    expect(m.direction).toBe('inbound')
  })

  it('T9: an SMB echo carrying `to` is outbound', () => {
    const m = chunk().threads[0].messages[0]
    expect(m.to).toBe(CUSTOMER_A)
    expect(m.direction).toBe('outbound')
  })

  it('T9b: a business message WITHOUT `to` is still outbound', () => {
    // Meta's own example contains exactly this. Reading absent `to` as inbound
    // would relabel half the archive and create leads from the business number.
    const m = chunk().threads[0].messages[1]
    expect(m.to).toBeNull()
    expect(m.from).toBe(BUSINESS_NUMBER)
    expect(m.direction).toBe('outbound')
  })

  it('T9c: derived from `from` vs the business number, exactly — not a last-9 match', () => {
    expect(historyDirection('15550001111', '15550001111', null)).toBe('outbound')
    expect(historyDirection('15550002222', '15550001111', null)).toBe('inbound')
    // Same last 9 digits, different number: must NOT be read as the business.
    expect(historyDirection('99550001111', '15550001111', null)).toBe('inbound')
    // Formatting differences are compared away; values are never rewritten.
    expect(historyDirection('+1 (555) 000-1111', '15550001111', null)).toBe('outbound')
  })

  it('T9d: falls back to the thread id when the business number is absent', () => {
    expect(historyDirection(CUSTOMER_A, null, CUSTOMER_A)).toBe('inbound')
    expect(historyDirection(BUSINESS_NUMBER, null, CUSTOMER_A)).toBe('outbound')
    // Neither available: null, never a guess.
    expect(historyDirection(BUSINESS_NUMBER, null, null)).toBeNull()
    expect(historyDirection(null, BUSINESS_NUMBER, CUSTOMER_A)).toBeNull()
  })
})

describe('message fields', () => {
  it('T10: the wamid is exposed as the canonical external id', () => {
    expect(chunk().threads[0].messages[0].externalId).toBe(WAMID_A1)
  })

  it('T11: a string Unix-seconds timestamp converts deterministically', () => {
    const m = chunk().threads[0].messages[0]
    expect(m.channelTimestamp).toBeInstanceOf(Date)
    expect(m.channelTimestamp?.toISOString()).toBe(new Date(Number(TS_A1) * 1000).toISOString())
    // Pinned absolutely, so a unit change (ms vs s) cannot pass silently.
    expect(m.channelTimestamp?.getTime()).toBe(1739230955000)
  })

  it('T12: a text body is extracted', () => {
    expect(chunk().threads[0].messages[0].text).toBe('Synthetic outbound body')
    expect(chunk().threads[0].messages[2].text).toBe('Synthetic inbound body')
  })

  it('T13: media_placeholder is flagged and its raw type preserved', () => {
    const m = chunk().threads[0].messages[1]
    expect(m.mediaPlaceholder).toBe(true)
    expect(m.rawType).toBe('media_placeholder')
    expect(m.supported).toBe(false)
    expect(m.text).toBe('')
  })

  it('T13b: history_context.status is preserved for every documented value', () => {
    expect(chunk().threads[0].messages.map((m) => m.historyStatus)).toEqual(['READ', 'PLAYED', 'READ'])
    expect(chunk().threads[1].messages[0].historyStatus).toBe('DELIVERED')
  })
})

describe('media follow-up (the second history shape)', () => {
  const followup = parseHistoryValue(HISTORY_MEDIA_FOLLOWUP_VALUE) as ParsedHistoryMediaFollowup

  it('T14: a top-level messages[] is a DISTINCT event kind, not a chunk', () => {
    expect(followup.kind).toBe('history_media_followup')
    expect(followup).not.toHaveProperty('threads')
    expect(followup.messages).toHaveLength(1)
  })

  it('T14b: it carries the wamid for later correlation, and asserts nothing more', () => {
    // Meta's example reuses the wamid but never documents that as a guarantee,
    // so the parser exposes it and refuses to merge. Correlation is 2A.2c's call.
    expect(followup.messages[0].externalId).toBe(WAMID_A2)
    expect(followup.messages[0].type).toBe('image')
    expect(followup.messages[0].payload).toMatchObject({ mime_type: 'image/jpeg' })
    expect(codeOf('lib/whatsapp/parseHistory.ts')).not.toMatch(/correlat|merge/i)
  })

  it('T14c: it has no thread identity, because the shape has none', () => {
    expect(followup.messages[0]).not.toHaveProperty('threadId')
    expect(followup.messages[0].direction).toBe('inbound')
  })
})

describe('history errors', () => {
  const err = parseHistoryValue(HISTORY_ERROR_VALUE) as ParsedHistoryErrorEvent

  it('T15: a decline is a structured error, never a message and never empty success', () => {
    expect(err.kind).toBe('history_error')
    expect(err.errors[0].code).toBe(HISTORY_SYNC_DISABLED_CODE)
    expect(HISTORY_SYNC_DISABLED_CODE).toBe(2593109)
    expect(err.errors[0].details).toBe('History sharing is turned off by the business')
    expect(err.errors[0].title).toContain('turned off')
  })

  it('T15b: it still carries the tenant key and chunk metadata slots', () => {
    expect(err.phoneNumberId).toBe(BUSINESS_PHONE_ID)
    expect(err.phase).toBeNull()
  })

  it('T15c: the parser does not decide retryability', () => {
    expect(err).not.toHaveProperty('retryable')
  })
})

describe('validation — rejects malformed input safely', () => {
  it.each([
    ['null body', null],
    ['a string', 'nope'],
    ['an array', []],
    ['missing entry', { object: 'whatsapp_business_account' }],
    ['missing changes', { entry: [{ id: '1' }] }],
    ['wrong field', envelope(HISTORY_CHUNK_VALUE, 'messages')],
  ])('T16: %s yields no events and does not throw', (_label, body) => {
    expect(() => parseHistoryWebhook(body)).not.toThrow()
    expect(parseHistoryWebhook(body)).toEqual([])
  })

  it('T17: a value with no phone_number_id is refused — it cannot be attributed', () => {
    expect(parseHistoryValue({ ...HISTORY_CHUNK_VALUE, metadata: {} })).toBeNull()
    expect(parseHistoryValue({ ...HISTORY_CHUNK_VALUE, metadata: undefined })).toBeNull()
  })

  it('T17b: missing history and missing threads degrade, they do not throw', () => {
    expect(parseHistoryValue({ metadata: { phone_number_id: BUSINESS_PHONE_ID } })).toBeNull()
    const noThreads = parseHistoryValue({
      metadata: { phone_number_id: BUSINESS_PHONE_ID },
      history: [{ metadata: { phase: 0, chunk_order: 1, progress: 0 } }],
    }) as ParsedHistoryChunk
    expect(noThreads.threads).toEqual([])
    expect(noThreads.skipped).toEqual([])
  })

  it('T18: a thread with no id is skipped, not silently dropped', () => {
    const c = chunk(HISTORY_DEGRADED_VALUE)
    expect(c.threads.map((t) => t.id)).toEqual([CUSTOMER_A])
    expect(c.skipped).toContainEqual({ reason: 'malformed_message', threadId: null, externalId: null })
  })

  it('T19: a message with no wamid is skipped — no id is ever invented', () => {
    const c = chunk(HISTORY_DEGRADED_VALUE)
    expect(c.skipped).toContainEqual({ reason: 'missing_wamid', threadId: CUSTOMER_A, externalId: null })
    expect(c.threads[0].messages.map((m) => m.externalId)).not.toContain(undefined)
  })

  it('T20: an unparseable timestamp is skipped — never replaced with now()', () => {
    const c = chunk(HISTORY_DEGRADED_VALUE)
    expect(c.skipped).toContainEqual({ reason: 'invalid_timestamp', threadId: CUSTOMER_A, externalId: WAMID_A1 })
    expect(codeOf('lib/whatsapp/parseHistory.ts')).not.toContain('new Date()')
    expect(codeOf('lib/whatsapp/parseHistory.ts')).not.toContain('Date.now')
  })

  it('T20b: invalid phase/chunk_order/progress become null, never 0', () => {
    // A chunk whose order we cannot trust must not masquerade as chunk 0.
    const c = chunk({
      metadata: { phone_number_id: BUSINESS_PHONE_ID },
      history: [{ metadata: { phase: 'x', chunk_order: 1.5, progress: null }, threads: [] }],
    })
    expect([c.phase, c.chunkOrder, c.progress]).toEqual([null, null, null])
  })

  it('T20c: does NOT overvalidate values Meta may extend', () => {
    // phase 3 and progress 150 are outside today's documented ranges. Rejecting
    // them would break this parser the day Meta widens the enum.
    const c = chunk({
      metadata: { phone_number_id: BUSINESS_PHONE_ID },
      history: [{ metadata: { phase: 3, chunk_order: 99, progress: 150 }, threads: [] }],
    })
    expect([c.phase, c.chunkOrder, c.progress]).toEqual([3, 99, 150])
  })

  it('T21: an unknown message type survives with its payload intact', () => {
    const m = chunk(HISTORY_DEGRADED_VALUE).threads[0].messages.find((x) => x.externalId === WAMID_A3)!
    expect(m.rawType).toBe('order_status_update')
    expect(m.type).toBe('unknown')
    expect(m.supported).toBe(false)
    expect(m.payload).toEqual({ status: 'shipped' })
    expect(m.historyStatus).toBe('SENT')
  })

  it('T21b: one bad message never strands its siblings', () => {
    const c = chunk(HISTORY_DEGRADED_VALUE)
    expect(c.skipped).toHaveLength(3)
    expect(c.threads[0].messages).toHaveLength(1)
  })
})

describe('purity', () => {
  const src = codeOf('lib/whatsapp/parseHistory.ts') + codeOf('lib/whatsapp/historyEvent.ts')

  it('T22: parsing is deterministic — same input, identical output', () => {
    expect(parseHistoryValue(HISTORY_CHUNK_VALUE)).toEqual(parseHistoryValue(HISTORY_CHUNK_VALUE))
    expect(parseHistoryWebhook(envelope(HISTORY_CHUNK_VALUE))).toEqual(
      parseHistoryWebhook(envelope(HISTORY_CHUNK_VALUE)),
    )
  })

  it('T22b: it does not mutate its input', () => {
    const before = JSON.stringify(HISTORY_CHUNK_VALUE)
    parseHistoryValue(HISTORY_CHUNK_VALUE)
    expect(JSON.stringify(HISTORY_CHUNK_VALUE)).toBe(before)
  })

  it('T23/T24/T25: no side effects — no db, no network, no queue, no logging', () => {
    for (const forbidden of [
      "from '@/db/",
      'ingestWhatsapp',
      'enqueue',
      'signal',
      'automation',
      'createLead',
      'findOrCreateConversation',
      'notify',
      'fetch(',
      'console.',
      'process.env',
    ]) {
      expect(src).not.toContain(forbidden)
    }
  })

  it('T25b: the only runtime import is the shared message adapter', () => {
    const imports = codeOf('lib/whatsapp/parseHistory.ts')
      .split('\n')
      .filter((l) => l.startsWith('import ') && !l.startsWith('import type'))
    expect(imports).toEqual(["import { parseWhatsappMessage } from '@/lib/adapters/whatsappMessage'"])
  })

  it('T25c: it exposes the dedup inputs and builds no second dedup system', () => {
    // (channel, externalId) is the existing key; the parser supplies its parts.
    const m = chunk().threads[0].messages[0]
    expect(m.externalId).toBe(WAMID_A1)
    expect(chunk().phoneNumberId).toBe(BUSINESS_PHONE_ID)
    expect(m.threadId).toBe(CUSTOMER_A)
    expect(src).not.toMatch(/dedup|seen\b|Set\(/i)
  })
})

describe('scope guard', () => {
  it('the parser stays a pure boundary; the gate is a literal, now true', () => {
    expect(codeOf('lib/whatsapp/coexistence.ts')).toContain('export const HISTORY_SYNC_ENABLED = true')
    expect(codeOf('lib/whatsapp/coexistence.ts')).not.toMatch(
      /HISTORY_SYNC_ENABLED\s*=\s*(process\.env|Boolean|!!)/,
    )
    // The parser is still reached only through the receive path, never imported
    // directly by the coexistence dispatcher or the webhook route.
    expect(codeOf('lib/whatsapp/coexistence.ts')).not.toContain('parseHistory')
    expect(codeOf('app/api/webhooks/whatsapp/route.ts')).not.toContain('parseHistory')
  })
})
