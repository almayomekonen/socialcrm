/**
 * The WhatsApp thread as the rep reads it: which rows are bubbles, which
 * reactions sit on which bubble, what a reply quotes, and what text a bubble
 * shows. Pure (no React, no data access). The desktop thread and the mobile
 * thread both render THIS, so the two cannot drift.
 *
 * REACTIONS ARE NEVER BUBBLES. A reaction row either becomes a small emoji on
 * the message it reacts to (when that message is in this thread, matched
 * exactly on the server) or a compact line of its own ("a reaction to an
 * earlier message"). It is never an ordinary bubble and never the
 * "unsupported message" notice.
 *
 * LATEST WINS, PER SENDER AND MESSAGE. A sender has at most one reaction on a
 * message: a later reaction replaces an earlier one, and a reaction without an
 * emoji (WhatsApp's removal) removes it.
 */
import type { LeadWhatsappMessage } from '@/db/inboxMessages'
import { isAudioAttachment, isImageAttachment, UNSUPPORTED_MESSAGE_NOTICE } from '@/lib/inbox/attachmentDisplay'

export type ThreadReaction = { emoji: string; byBusiness: boolean }

/** What a reply quotes: a short preview, or null when the quoted message is not in this thread. */
export type ThreadQuote = { preview: string | null }

export type ThreadEntry =
  | { kind: 'message'; key: string; message: LeadWhatsappMessage; reactions: ThreadReaction[]; quote: ThreadQuote | null }
  | {
      kind: 'reaction'
      key: string
      emoji: string
      byBusiness: boolean
      direction: LeadWhatsappMessage['direction']
      timestamp: string
    }

/** Shown when a reply's quoted message is not in this thread. */
export const QUOTE_NOT_FOUND = 'תגובה להודעה קודמת'
const QUOTE_PREVIEW_CHARS = 80

const TYPE_WORDS: Partial<Record<LeadWhatsappMessage['type'], string>> = {
  image: 'תמונה',
  video: 'סרטון',
  document: 'מסמך',
  audio: 'הודעה קולית',
  sticker: 'מדבקה',
  location: 'מיקום',
  contacts: 'איש קשר',
}

/**
 * The text a bubble shows: its text, else its caption, else nothing for a file
 * (the file is the content), else the unsupported notice. Null for a text
 * message with no text, which each surface marks its own way.
 */
export function messageBody(m: LeadWhatsappMessage): string | null {
  if (m.text) return m.text
  if (m.caption) return m.caption
  if (m.attachment) return ''
  if (m.type === 'text') return null
  return UNSUPPORTED_MESSAGE_NOTICE
}

/** A captionless photo IS the bubble; a photo and a voice note carry their own time. */
export function bubbleMediaLayout(m: LeadWhatsappMessage): { photoBubble: boolean; mediaCarriesTime: boolean } {
  const photoBubble = isImageAttachment(m.attachment?.mimeType) && !m.text && !m.caption
  return { photoBubble, mediaCarriesTime: photoBubble || isAudioAttachment(m.attachment?.mimeType) }
}

/** One line of the quoted message, or what kind of message it was. */
export function quotePreview(target: LeadWhatsappMessage): string {
  const line = (target.text || target.caption || '').trim().split('\n')[0].trim()
  if (line) return line.length > QUOTE_PREVIEW_CHARS ? `${line.slice(0, QUOTE_PREVIEW_CHARS)}…` : line
  if (target.type === 'document' && target.attachment?.filename) return target.attachment.filename
  return TYPE_WORDS[target.type] ?? 'הודעה'
}

function reactionKey(m: LeadWhatsappMessage): string {
  const r = m.reaction
  // The ref first: every reaction to the same message has the same ref, whether or not that
  // message was in the table when the row was read; `targetId` can differ between reads.
  const target = r?.targetRef ? `ref:${r.targetRef}` : r?.targetId != null ? `id:${r.targetId}` : `row:${m.id}`
  return `${m.direction}|${target}`
}

/** The thread's entries, in the order of `messages`. */
export function buildThreadEntries(messages: LeadWhatsappMessage[]): ThreadEntry[] {
  const byId = new Map(messages.map((m) => [m.id, m]))

  // The reaction that is current for each sender and message: the last one.
  const current = new Map<string, LeadWhatsappMessage>()
  for (const m of messages) if (m.type === 'reaction') current.set(reactionKey(m), m)

  // Current reactions whose message is in this thread sit on that message.
  const onMessage = new Map<number, ThreadReaction[]>()
  const attached = new Set<number>()
  for (const m of current.values()) {
    const targetId = m.reaction?.targetId
    const emoji = m.reaction?.emoji
    if (!emoji || targetId == null || !byId.has(targetId) || byId.get(targetId)?.type === 'reaction') continue
    const list = onMessage.get(targetId) ?? []
    list.push({ emoji, byBusiness: m.direction === 'outbound' })
    onMessage.set(targetId, list)
    attached.add(m.id)
  }

  const entries: ThreadEntry[] = []
  for (const m of messages) {
    if (m.type === 'reaction') {
      const emoji = m.reaction?.emoji
      // Superseded, removed, or shown on its message: no entry of its own.
      if (!emoji || current.get(reactionKey(m)) !== m || attached.has(m.id)) continue
      entries.push({ kind: 'reaction', key: `r${m.id}`, emoji, byBusiness: m.direction === 'outbound', direction: m.direction, timestamp: m.timestamp })
      continue
    }
    const target = m.replyTo?.targetId != null ? byId.get(m.replyTo.targetId) : undefined
    entries.push({
      kind: 'message',
      key: `m${m.id}`,
      message: m,
      reactions: onMessage.get(m.id) ?? [],
      quote: m.replyTo ? { preview: target ? quotePreview(target) : null } : null,
    })
  }
  return entries
}

/** The timestamp and side of an entry, for day separators and grouping. */
export function entryMeta(e: ThreadEntry): { timestamp: string; direction: LeadWhatsappMessage['direction'] } {
  return e.kind === 'message' ? { timestamp: e.message.timestamp, direction: e.message.direction } : { timestamp: e.timestamp, direction: e.direction }
}
