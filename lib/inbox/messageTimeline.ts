/**
 * The message timeline — how `inbox_messages` rows are ordered chronologically,
 * and how an imported history row is told apart from a live one.
 *
 * WHY THIS MODULE EXISTS. Until now "chronological" was implied by `sequence`,
 * which is assigned `MAX(sequence) + 1` per conversation at insert time. That is
 * ORDER OF ARRIVAL AT US, not order of occurrence. For live traffic the two
 * coincide, so nothing was ever wrong. The moment a WhatsApp Coexistence history
 * archive is imported they diverge completely: a message the customer sent in
 * January would be inserted today and receive both the highest `sequence` and
 * the highest `id` in its conversation, and every reader that trusted either one
 * would render a months-old message as the newest thing in the thread.
 *
 * `sequence` IS NOT CHANGED, and its meaning is not changed. It stays "order of
 * arrival at our system", which is what `triggerSequence`, the turn classifier,
 * `conversation_intelligence.coveredSequence` and the auto-response jobs all
 * mean by it. Renumbering it would strand every one of those references. This
 * module adds a SECOND, chronological ordering alongside it and moves only the
 * readers that were asking a chronological question.
 *
 * THE ORDERING KEY is `(COALESCE(channelTimestamp, createdAt), id)`:
 *   - `channelTimestamp` is Meta's own moment — when the message actually
 *     happened. It is the truth whenever we have it.
 *   - `createdAt` is our ingest moment, the fallback for the rows where Meta
 *     sent no timestamp. It is nullable-free, so the COALESCE is total.
 *   - `id` breaks ties. Two messages can share a timestamp — WhatsApp reports
 *     whole seconds — and without a tiebreak Postgres may return them in either
 *     order on any given run, which makes a thread flicker between renders.
 *     `id` is monotonic and unique, so the composite is a TOTAL order.
 *
 * Everything here is a pure string builder with no `db` import, matching
 * `waitingReplySql.ts`. That keeps it usable from query builders and from raw
 * SQL subqueries alike, and keeps it testable without a connection.
 */

/**
 * The canonical marker for a message imported from a Coexistence history
 * archive: `metadata.source = 'whatsapp_history'`.
 *
 * IT IS A MARKER, NOT AN INFERENCE. "Old timestamp" is not a usable proxy for
 * "historical" — Meta redelivers live webhooks late, and an echo of a message
 * the business sent an hour ago can arrive after a delay. Only the importer
 * knows a row came from an archive, so only the importer can say so, and it
 * says so here.
 *
 * IT MUST STAY DISTINCT FROM the other two markers on this column.
 * `auto_response` means the instant-response engine sent it, and `leadFacts`
 * reads that to decide a machine did not count as a human reply.
 * `smb_message_echo` means the business sent it from their phone, which DOES
 * count as a human reply. Collapsing history into either would silently change
 * `lastHumanOutboundAt`, and with it `isWaitingForReply`, Today, and the
 * `conversation.unanswered` signal.
 *
 * No new column: `metadata` is jsonb and already carries exactly this
 * convention.
 */
export const HISTORY_SOURCE = 'whatsapp_history'

/** The authoritative chronological key for a message row. Never null. */
export function messageOccurredAtSql(alias = 'm'): string {
  return `COALESCE(${alias}."channelTimestamp", ${alias}."createdAt")`
}

/**
 * The total chronological order: occurrence, then `id` as the deterministic
 * tiebreak. One definition so the thread readers cannot drift apart — three
 * copies of an ORDER BY is how the lead page and the conversation page end up
 * disagreeing about the same messages.
 */
export function messageTimelineOrderSql(alias = 'm', direction: 'asc' | 'desc' = 'asc'): string {
  const d = direction === 'desc' ? 'DESC' : 'ASC'
  return `${messageOccurredAtSql(alias)} ${d}, ${alias}.id ${d}`
}

/**
 * The exclusion predicate for reads that mean CURRENT LIVE STATE.
 *
 * `IS DISTINCT FROM` rather than `<>` because `metadata->>'source'` is NULL for
 * every ordinary message, and `NULL <> 'whatsapp_history'` is NULL, not true —
 * which would filter out the entire live inbox. This mirrors the existing
 * `auto_response` exclusion in `leadFacts` exactly.
 */
export function notHistorySql(alias = 'm'): string {
  return `(${alias}.metadata->>'source') IS DISTINCT FROM '${HISTORY_SOURCE}'`
}

/**
 * The one way to stamp the marker, for the importer that does not exist yet
 * (Wave 2A.2c). Returns the fragment and its binding rather than a knex `Raw`
 * so this module stays connection-free.
 *
 * `metadata || ?::jsonb` MERGES rather than replaces, which is the established
 * convention: `ingestWhatsappEcho` and the instant-response engine both write
 * their marker this way, and a plain assignment would discard whatever else the
 * insert put on the row.
 */
export function historySourceMerge(extra?: Record<string, unknown>): { sql: string; bindings: [string] } {
  // `extra` carries import provenance (chunk identity, Meta's own status, the
  // raw type) alongside the marker, in ONE merge. `source` is always written by
  // this function and cannot be overridden by a caller's key, so the marker
  // every reader keys on has exactly one writer.
  return {
    sql: `metadata || ?::jsonb`,
    bindings: [JSON.stringify({ ...(extra ?? {}), source: HISTORY_SOURCE })],
  }
}
