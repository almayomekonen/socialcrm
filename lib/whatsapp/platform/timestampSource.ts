/**
 * Where an inbound message's stored `messageTimestamp` came from.
 *
 *   'meta'    Meta's own send time, in a plausible range: at most 7 days before
 *             receipt and at most 5 minutes after it. The only value the Reminder
 *             Engine may use to anchor a reminder or judge WhatsApp's 24-hour window.
 *   'server'  Meta sent no usable timestamp, so the server time at receipt was stored.
 *   null      Meta sent a timestamp outside that range. It is still stored, as
 *             before, for opt-out ordering, but it counts as unverified, exactly
 *             like historical rows recorded before this column existed.
 */
export type TimestampSource = 'meta' | 'server' | null

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_AHEAD_MS = 5 * 60 * 1000

export function timestampSource(metaSeconds: number | null, receivedAtMs: number): TimestampSource {
  if (metaSeconds === null) return 'server'
  const ms = metaSeconds * 1000
  return ms >= receivedAtMs - MAX_AGE_MS && ms <= receivedAtMs + MAX_AHEAD_MS ? 'meta' : null
}
