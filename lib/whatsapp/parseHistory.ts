import { parseWhatsappMessage } from '@/lib/adapters/whatsappMessage'
import type {
  HistoryDirection,
  HistoryError,
  HistorySkip,
  ParsedHistoryEvent,
  ParsedHistoryMessage,
  ParsedHistoryThread,
} from '@/lib/whatsapp/historyEvent'

/**
 * WhatsApp Coexistence `history` webhook → normalized events.
 *
 * A PURE BOUNDARY ADAPTER. No database, no network, no queue, no clock, no
 * logging of payload contents. It converts what Meta sent into what we can
 * reason about, and does nothing else. Everything that ACTS on a history
 * archive — conversations, messages, leads, jobs — is Wave 2A.2c and does not
 * exist yet. A test asserts the forbidden imports are absent, because a pure
 * parser stays pure only while nothing convenient is reachable from it.
 *
 * WRITTEN AGAINST META'S PUBLISHED CONTRACT, not against a captured payload.
 * Every field name, enum and shape below comes from the official `history`
 * webhook reference. Where the documentation is silent — media/placeholder
 * correlation, chunk redelivery, ordering between phases — this parser
 * PRESERVES the raw signal and decides nothing.
 *
 * TOTAL AND FAIL-SOFT. The webhook must answer 200 or Meta retries and can
 * disable the subscription, and a history delivery can carry thousands of
 * messages. One unusable message is recorded as a skip and its siblings are
 * kept; nothing here throws.
 *
 * NOTE (architecture-rules §6): this file is ~300 lines, over the 250 soft
 * limit, and intentionally so. It is ONE concern — decoding one webhook field —
 * expressed as a single linear descent through Meta's three documented shapes.
 * The line count is documentation, not logic: the rules that matter here
 * (direction, wamid, timestamp, chunk identity) are each one or two statements
 * wrapped in the reasoning that makes them reviewable. Splitting the descent
 * across micro-modules would mean threading `businessNumber`, `threadId` and the
 * skip accumulator between them for no readability gain. The normalized types
 * are already extracted to `historyEvent.ts`.
 */

const HISTORY_FIELD = 'history'

/** Documented: the business turned history sharing off in the WhatsApp Business app. */
export const HISTORY_SYNC_DISABLED_CODE = 2593109

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/**
 * An integer, or null.
 *
 * `phase`, `chunk_order` and `progress` are documented as integers, and a
 * non-integer is reported as absent rather than coerced — a chunk whose order
 * we cannot trust must not masquerade as chunk 0. Deliberately NOT range-checked
 * beyond that: Meta documents phases 0–2 and progress 0–100 today, and rejecting
 * a value outside those bounds would break this parser the day Meta adds phase 3
 * (§11: do not overvalidate).
 */
function int(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v)
  return null
}

/** Digits only — for COMPARING two numbers, never for storing one. */
function digits(v: string | null): string {
  return v ? v.replace(/\D/g, '') : ''
}

/**
 * Direction, derived — Meta documents no `direction` field.
 *
 * PRIMARY RULE: `from` is the business's own number → the business sent it
 * (outbound); anything else came from the customer (inbound).
 *
 * WHY NOT THE `to` FIELD. Meta says `to` is "only included if the message object
 * represents an SMB message echo", which makes its PRESENCE sufficient evidence
 * of outbound but its ABSENCE no evidence at all — Meta's own example contains a
 * business-sent message with `history_context.status: READ` and no `to`. Reading
 * absence as inbound would relabel half the archive, create leads out of the
 * business's own number, and — once persistence exists — corrupt
 * `lastHumanOutboundAt` for every thread the business had answered.
 *
 * FALLBACK, only when `display_phone_number` is missing: compare `from` against
 * the thread id, which Meta documents as the WhatsApp USER's phone number. Equal
 * means the customer sent it. This is why the media follow-up shape — which has
 * no threads — can return null: with no business number and no thread there is
 * no documented way to know, and a guess is worse than an honest null.
 *
 * Comparison is digits-only, and EXACT rather than the last-9 `phoneCore` used
 * for lead matching: a loose match can equate two different numbers, and the
 * cost of that here is a mislabelled direction on every message in a thread.
 */
export function historyDirection(
  from: string | null,
  businessNumber: string | null,
  threadId: string | null,
): HistoryDirection | null {
  const f = digits(from)
  if (!f) return null

  const biz = digits(businessNumber)
  if (biz) return f === biz ? 'outbound' : 'inbound'

  const thread = digits(threadId)
  if (thread) return f === thread ? 'inbound' : 'outbound'

  return null
}

type MessageContext = {
  businessNumber: string | null
  threadId: string | null
}

/**
 * One message object → normalized, or a skip.
 *
 * Reuses `parseWhatsappMessage` for the envelope it shares with live inbound
 * traffic and with echoes, then adds what only history carries.
 */
function parseHistoryMessage(
  raw: unknown,
  ctx: MessageContext,
): { message: ParsedHistoryMessage } | { skip: HistorySkip } {
  const m = obj(raw)
  if (!m) return { skip: { reason: 'malformed_message', threadId: ctx.threadId, externalId: null } }

  const parsed = parseWhatsappMessage(m)

  // The wamid IS the dedup key `(channel, externalId)` the persistence layer
  // already uses. Without one the message cannot be made idempotent and Meta
  // redelivers on any non-2xx, so it is refused rather than given an invented id.
  if (!parsed.externalId) {
    return { skip: { reason: 'missing_wamid', threadId: ctx.threadId, externalId: null } }
  }

  // The source timestamp is authoritative and there is no fallback: `new Date()`
  // would stamp a months-old message with the moment we imported it, which is
  // the precise error the whole timeline foundation exists to prevent.
  if (!parsed.channelTimestamp) {
    return { skip: { reason: 'invalid_timestamp', threadId: ctx.threadId, externalId: parsed.externalId } }
  }

  const rawType = typeof m.type === 'string' ? m.type : 'unknown'
  const from = str(m.from)

  return {
    message: {
      ...parsed,
      externalId: parsed.externalId,
      threadId: ctx.threadId ?? '',
      customerWaId: ctx.threadId ?? '',
      direction: historyDirection(from, ctx.businessNumber, ctx.threadId),
      from: from ?? '',
      to: str(m.to),
      rawType,
      mediaPlaceholder: rawType === 'media_placeholder',
      historyStatus: str(obj(m.history_context)?.status),
      // An unknown type is PRESERVED, never discarded: `rawType` and `payload`
      // keep everything Meta sent, so a type we do not map today is still
      // importable, and a future release can interpret it without a re-sync
      // that is no longer possible.
      supported: parsed.type !== 'unknown',
    },
  }
}

function parseErrors(raw: unknown): HistoryError[] {
  return arr(raw)
    .map(obj)
    .filter((e): e is Record<string, unknown> => e !== null)
    .map((e) => ({
      code: int(e.code),
      title: str(e.title),
      message: str(e.message),
      details: str(obj(e.error_data)?.details),
    }))
}

/**
 * One webhook `value` → one normalized event, or null when the payload is not a
 * usable history value.
 *
 * This is the entry point that matches the existing pipeline:
 * `processCoexistenceWebhook(field, value)` already receives exactly this.
 * It also accepts the DECLINED shape, which Meta documents without the
 * `entry`/`changes` wrapper.
 */
export function parseHistoryValue(value: unknown): ParsedHistoryEvent | null {
  const v = obj(value)
  if (!v) return null

  const metadata = obj(v.metadata)
  // The tenant key. Without it the payload cannot be attributed to an agency,
  // and attributing it by any other field would be a guess with cross-tenant
  // consequences.
  const phoneNumberId = str(metadata?.phone_number_id)
  if (!phoneNumberId) return null

  const displayPhoneNumber = str(metadata?.display_phone_number)
  const base = { phoneNumberId, displayPhoneNumber }

  // Shape 2: the media follow-up — a top-level `messages[]`, no threads.
  // Checked BEFORE `history`, because the two are mutually exclusive and this
  // one is the shape a naive parser silently drops.
  if (Array.isArray(v.messages)) {
    const messages: ReturnType<typeof stripThread>[] = []
    const skipped: HistorySkip[] = []
    for (const raw of v.messages) {
      const r = parseHistoryMessage(raw, { businessNumber: displayPhoneNumber, threadId: null })
      if ('skip' in r) skipped.push(r.skip)
      else messages.push(stripThread(r.message))
    }
    return { kind: 'history_media_followup', ...base, messages, skipped }
  }

  const history = arr(v.history)
  if (history.length === 0) return null

  // Shape 3: an error. Meta puts it in the first history entry; scanning them
  // all means a mixed delivery cannot hide one.
  const errorEntry = history.map(obj).find((h) => h !== null && Array.isArray(h.errors))
  if (errorEntry) {
    const meta = obj(errorEntry.metadata)
    return {
      kind: 'history_error',
      ...base,
      errors: parseErrors(errorEntry.errors),
      phase: int(meta?.phase),
      chunkOrder: int(meta?.chunk_order),
      progress: int(meta?.progress),
    }
  }

  // Shape 1: a history chunk.
  const entry = obj(history[0])
  const meta = obj(entry?.metadata)
  const skipped: HistorySkip[] = []
  const threads: ParsedHistoryThread[] = []

  for (const rawThread of arr(entry?.threads)) {
    const t = obj(rawThread)
    const threadId = str(t?.id)
    // A thread with no id has no customer identity, so its messages cannot be
    // attached to a conversation. Recorded, not silently dropped.
    if (!threadId) {
      skipped.push({ reason: 'malformed_message', threadId: null, externalId: null })
      continue
    }

    const messages: ParsedHistoryMessage[] = []
    for (const rawMessage of arr(t?.messages)) {
      const r = parseHistoryMessage(rawMessage, { businessNumber: displayPhoneNumber, threadId })
      if ('skip' in r) skipped.push(r.skip)
      else messages.push(r.message)
    }
    threads.push({ id: threadId, messages })
  }

  return {
    kind: 'history_chunk',
    ...base,
    // Preserved verbatim, never interpreted. Chunks are documented to arrive
    // out of order, so `chunkOrder` is NOT this entry's array index and the
    // parser must not imply otherwise.
    phase: int(meta?.phase),
    chunkOrder: int(meta?.chunk_order),
    progress: int(meta?.progress),
    threads,
    skipped,
  }
}

function stripThread(m: ParsedHistoryMessage) {
  const { threadId: _t, customerWaId: _c, ...rest } = m
  return rest
}

/**
 * A full webhook body → every history event it contains.
 *
 * Meta batches `entry[].changes[]`, and only changes whose `field` is `history`
 * are read — a delivery mixing fields must not have its echoes or state-sync
 * entries misread as archive content.
 */
export function parseHistoryWebhook(body: unknown): ParsedHistoryEvent[] {
  const b = obj(body)
  if (!b) return []

  const out: ParsedHistoryEvent[] = []
  for (const rawEntry of arr(b.entry)) {
    for (const rawChange of arr(obj(rawEntry)?.changes)) {
      const change = obj(rawChange)
      if (str(change?.field) !== HISTORY_FIELD) continue
      const event = parseHistoryValue(change?.value)
      if (event) out.push(event)
    }
  }
  return out
}
