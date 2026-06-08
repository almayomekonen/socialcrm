import type { InboxMessageType } from '@/db/inboxMessages'

/**
 * Normalize a raw WhatsApp Cloud API message object into a channel-neutral shape
 * for inbox persistence. Sibling to parseWhatsappLead — pure, fail-soft.
 *
 * A raw message looks like:
 *   { id: "wamid...", from: "9725...", timestamp: "1717000000",
 *     type: "text", text: { body: "hi" } }
 * Non-text types carry their content under a key equal to `type`
 * (image/document/audio/video/sticker/location/contacts/interactive/...).
 */

export type ParsedWhatsappMessage = {
  externalId: string | null
  type: InboxMessageType
  text: string
  payload: Record<string, unknown>
  channelTimestamp: Date | null
}

const KNOWN_TYPES: InboxMessageType[] = [
  'text',
  'image',
  'document',
  'audio',
  'video',
  'sticker',
  'location',
  'contacts',
  'interactive',
  'button',
  'reaction',
]

export function parseWhatsappMessage(raw: unknown): ParsedWhatsappMessage {
  try {
    const m = (raw ?? {}) as Record<string, unknown>
    const externalId = typeof m.id === 'string' ? m.id : null

    const rawType = typeof m.type === 'string' ? m.type : 'unknown'
    const type: InboxMessageType = (KNOWN_TYPES as string[]).includes(rawType)
      ? (rawType as InboxMessageType)
      : 'unknown'

    // Text body for text messages; empty string otherwise (content lives in payload).
    const textNode = m.text as { body?: unknown } | undefined
    const text = type === 'text' && typeof textNode?.body === 'string' ? textNode.body : ''

    // Capture the type-specific content object as payload (e.g. m.image, m.location).
    const content = m[rawType]
    const payload: Record<string, unknown> =
      content && typeof content === 'object' ? (content as Record<string, unknown>) : {}

    // WhatsApp timestamps are unix seconds as a string.
    const tsRaw = m.timestamp
    const tsNum = typeof tsRaw === 'string' || typeof tsRaw === 'number' ? Number(tsRaw) : NaN
    const channelTimestamp = Number.isFinite(tsNum) && tsNum > 0 ? new Date(tsNum * 1000) : null

    return { externalId, type, text, payload, channelTimestamp }
  } catch (err) {
    console.error('[parseWhatsappMessage] Failed to parse:', err)
    return { externalId: null, type: 'unknown', text: '', payload: {}, channelTimestamp: null }
  }
}
