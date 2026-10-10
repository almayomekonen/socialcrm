/**
 * What a WhatsApp message says beyond its text: a media caption, a reaction to
 * another message, a reply quoting another message.
 *
 * TARGETS ARE RESOLVED IN SQL, BY EXACT MATCH ONLY: same conversation, same
 * channel, and the exact external message id WhatsApp gave us. Nothing here
 * decodes, normalizes or guesses at the format of a WhatsApp message id. A
 * target that does not match exactly stays `null`, and the thread says so
 * honestly ("a reaction to an earlier message") instead of attaching it to the
 * wrong bubble.
 *
 * The browser receives only our own row id of the target. External message ids
 * and raw payloads never leave the server.
 */

/**
 * Extra columns every thread read selects (alias `m`). Read-only subqueries
 * over the (channel, externalId) unique index.
 *
 * The quoted message id comes from the inbound row's raw webhook message
 * (`context.id`), or from `metadata.replyTo.id` on a Coexistence echo, which is
 * stored without a raw payload. A context without an `id` (a forwarded-message
 * marker) is not a reply.
 */
export const MESSAGE_REF_SELECT_SQL = `
  (SELECT t.id FROM inbox_messages t
    WHERE m.type = 'reaction'
      AND t."conversationId" = m."conversationId"
      AND t.channel = m.channel
      AND t."externalId" = m.payload->>'message_id'
      AND t.id <> m.id
    LIMIT 1) AS "reactionTargetId",
  (COALESCE(m."rawPayload"->'context'->>'id', m.metadata->'replyTo'->>'id') IS NOT NULL) AS "hasReplyContext",
  (SELECT t.id FROM inbox_messages t
    WHERE t."conversationId" = m."conversationId"
      AND t.channel = m.channel
      AND t."externalId" = COALESCE(m."rawPayload"->'context'->>'id', m.metadata->'replyTo'->>'id')
      AND t.id <> m.id
    LIMIT 1) AS "replyTargetId"`

/** Media types WhatsApp lets a sender caption (audio and stickers have none). */
const CAPTIONED_TYPES: ReadonlySet<string> = new Set(['image', 'video', 'document'])
const MAX_CAPTION_CHARS = 1024
const MAX_EMOJI_CHARS = 32

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const asId = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null)

/** A sender's caption, as text: control characters other than line breaks removed. */
export function sanitizeCaption(type: unknown, payload: unknown): string | null {
  if (typeof type !== 'string' || !CAPTIONED_TYPES.has(type)) return null
  const raw = asRecord(payload)?.caption
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim()
  return cleaned ? cleaned.slice(0, MAX_CAPTION_CHARS) : null
}

/**
 * The emoji a reaction carries, or null when WhatsApp omitted it, which is how
 * a REMOVED reaction arrives. Bounded and free of control characters; anything
 * else is the sender's own content and is shown as it came.
 */
export function sanitizeReactionEmoji(payload: unknown): string | null {
  const raw = asRecord(payload)?.emoji
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim()
  return cleaned && cleaned.length <= MAX_EMOJI_CHARS ? cleaned : null
}

export type MessageReaction = {
  /** Null: the sender removed their reaction. */
  emoji: string | null
  /** Our row id of the message reacted to, or null when it is not in this conversation's thread. */
  targetId: number | null
}

export type MessageReplyTo = {
  /** Our row id of the quoted message, or null when it is not in this conversation's thread. */
  targetId: number | null
}

/** The optional fields this module adds to a thread message; absent when they do not apply. */
export function messageRefsForRow(r: Record<string, unknown>): {
  caption?: string
  reaction?: MessageReaction
  replyTo?: MessageReplyTo
} {
  const caption = sanitizeCaption(r.type, r.payload)
  return {
    ...(caption ? { caption } : {}),
    ...(r.type === 'reaction'
      ? { reaction: { emoji: sanitizeReactionEmoji(r.payload), targetId: asId(r.reactionTargetId) } }
      : {}),
    ...(r.hasReplyContext === true && r.type !== 'reaction' ? { replyTo: { targetId: asId(r.replyTargetId) } } : {}),
  }
}
