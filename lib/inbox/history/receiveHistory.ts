import { parseHistoryValue } from '@/lib/whatsapp/parseHistory'
import { resolveHistoryTenant } from '@/lib/inbox/persistHistoryMessage'
import { recordHistoryDelivery } from '@/db/whatsappHistoryImports'

/**
 * The webhook's entire history responsibility: write the delivery down, then
 * return.
 *
 * RECEIVE → DURABLE RECORD → ACKNOWLEDGE → (later) PROCESS. Importing inside the
 * request is not an option: `maxDuration` on the webhook route is 60 seconds, a
 * history delivery can carry thousands of messages, and Meta's archive cannot be
 * re-requested if the function times out halfway. So this does two queries — a
 * tenant lookup and one insert — and nothing else. Processing is
 * `lib/inbox/history/importWorker.ts`, draining on its own schedule.
 *
 * IT NEVER THROWS, but it does NOT hide infrastructure failure either (Wave
 * 2A.2g.1, F-2). Every failure is a returned outcome, and exactly one of them —
 * `failed` — means "do not acknowledge". The caller turns that into a non-2xx so
 * Meta redelivers.
 *
 * THE 200/NON-2XX SPLIT IS DELIBERATE. `unparseable` and `unknown_tenant` are
 * answered 200 because a redelivery of the identical body produces the identical
 * result: the first has no attributable content (no `phone_number_id`, or no
 * history entries at all — the parser is otherwise fail-soft and degrades to
 * per-message skips rather than returning null), and the second means no
 * connection exists to own it. Returning non-2xx for either would put Meta into
 * a retry loop it can respond to by disabling the subscription — losing far more
 * than the delivery in hand. A DURABLE-WRITE FAILURE is the opposite case: the
 * content is attributable and storable, we simply could not store it this time.
 *
 * IT DOES NOT CHECK THE GATE. `HISTORY_SYNC_ENABLED` lives in
 * `lib/whatsapp/coexistence.ts`, which is the only caller and checks it before
 * calling — keeping the constant's owner and its enforcement in one file, and
 * this module free of a circular import.
 */

export type ReceiveHistoryResult =
  | { outcome: 'recorded'; importId: number; kind: string }
  /** A redelivery of a chunk already on record. Expected traffic, never an error. */
  | { outcome: 'duplicate'; importId: number }
  | { outcome: 'unparseable' }
  /** No connection for this phone_number_id — nothing can be attributed to a tenant. */
  | { outcome: 'unknown_tenant' }
  /**
   * The durable write (or the lookup it depends on) FAILED. The caller must NOT
   * acknowledge: Meta redelivers only on a non-2xx, and this is the one outcome
   * where a redelivery is both possible and necessary.
   */
  | { outcome: 'failed'; error: string }

export async function receiveHistoryWebhook(value: unknown): Promise<ReceiveHistoryResult> {
  try {
    const event = parseHistoryValue(value)
    if (!event) {
      console.warn('[WhatsappHistory] unparseable history value — ignoring')
      return { outcome: 'unparseable' }
    }

    // The tenant comes from `phone_number_id` via `whatsapp_connections`, the
    // same mapping every other WhatsApp ingestion path uses. It is never read
    // from the payload, and the customer's number is never a tenant key.
    const agencyId = await resolveHistoryTenant(event.phoneNumberId)
    if (agencyId === null) {
      console.warn('[WhatsappHistory] no connection for phone_number_id — ignoring')
      return { outcome: 'unknown_tenant' }
    }

    // The RAW value is stored, not the parsed result: if the parser has a bug,
    // the archive is still recoverable from what Meta actually sent.
    const { id, inserted } = await recordHistoryDelivery({
      agencyId,
      phoneNumberId: event.phoneNumberId,
      event,
      rawValue: value,
    })

    if (!inserted) {
      console.log('[WhatsappHistory] history_chunk_duplicate', { importId: id, agencyId })
      return { outcome: 'duplicate', importId: id }
    }

    console.log('[WhatsappHistory] history_chunk_received', {
      importId: id,
      agencyId,
      kind: event.kind,
      phase: event.kind === 'history_chunk' ? event.phase : null,
      chunkOrder: event.kind === 'history_chunk' ? event.chunkOrder : null,
      progress: event.kind === 'history_chunk' ? event.progress : null,
    })
    return { outcome: 'recorded', importId: id, kind: event.kind }
  } catch (err) {
    // A durable-write failure is the one case where the one-shot archive is
    // genuinely at risk, so it is reported UP rather than swallowed. Previously
    // this returned an outcome the route ignored, the webhook answered 200, and
    // Meta never sent that piece of the archive again.
    const error = String((err as Error)?.message ?? err).slice(0, 200)
    console.error('[WhatsappHistory] history_receive_failed', { error })
    return { outcome: 'failed', error }
  }
}
