import { z } from 'zod'
import { conversationUrl } from '@/lib/oauth/server/config'
import { INTENT_VALUES, TEMPERATURE_VALUES } from '@/lib/ai/prompts/conversationAnalysis'
import type { ConversationHeader, ConversationIntel, McpMessageRow } from '@/db/mcpConversations'
import { AUTO_RESPONSE_SOURCE } from '@/lib/today/constants'
import { iso, untrustedText } from './present'

/**
 * How MCP tools present WhatsApp conversations. Stored intelligence first; raw
 * message text only on explicit request, through a STRICTER presenter than the
 * one for lead fields.
 *
 * Message text is customer-written and the highest-risk field in Phase A. It is
 * scrubbed of email-, WhatsApp-JID- and phone-shaped substrings (7+ digits here,
 * stricter than lead fields) and capped. This is best-effort masking of obvious
 * patterns, NOT a guarantee that no personal data remains: a customer can type
 * an address, a name or an id in words. Tool descriptions say so.
 */

export const CONVERSATION_CHANNEL = 'whatsapp' as const
export const MESSAGE_TEXT_MAX = 1000
const SUMMARY_MAX = 1200

const EMAIL_OR_JID_RE = /[^\s@]+@[^\s@]+(?:\.[^\s@]+)*/g
const PHONE_7_RE = /\+?\(?\d(?:[\s.\-/()]*\d){6,}/g
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g
// Types whose text can be a contact card or a place — never forwarded as text.
const NO_TEXT_TYPES = new Set(['contacts', 'location'])

export function scrubMessageText(s: string): string {
  return s.replace(EMAIL_OR_JID_RE, '[email hidden]').replace(PHONE_7_RE, '[phone hidden]')
}

export function messageText(type: string, raw: unknown): { text: string | null; contentTruncated: boolean } {
  if (NO_TEXT_TYPES.has(type) || typeof raw !== 'string') return { text: null, contentTruncated: false }
  const s = scrubMessageText(raw.replace(CONTROL_RE, '')).trim()
  if (!s) return { text: null, contentTruncated: false }
  return s.length > MESSAGE_TEXT_MAX
    ? { text: `${s.slice(0, MESSAGE_TEXT_MAX - 1)}…`, contentTruncated: true }
    : { text: s, contentTruncated: false }
}

const oneOf = <T extends readonly string[]>(values: T, v: unknown): T[number] | null =>
  typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T[number]) : null

export const INTELLIGENCE_STATUSES = ['fresh', 'stale', 'failed', 'none'] as const

/** Stored values only; anything missing or outside the known enums is null. */
export function intelOf(i: ConversationIntel | undefined) {
  return {
    summary: i && typeof i.summary === 'string' ? untrustedText(i.summary, SUMMARY_MAX) : null,
    intent: oneOf(INTENT_VALUES, i?.intent),
    temperature: oneOf(TEMPERATURE_VALUES, i?.temperature),
    intelligenceStatus: oneOf(INTELLIGENCE_STATUSES, i?.status) ?? 'none',
    intelligenceUpdatedAt: iso(i?.updatedAt),
  }
}

export const intelShape = {
  summary: z.string().nullable(),
  intent: z.enum(INTENT_VALUES).nullable(),
  temperature: z.enum(TEMPERATURE_VALUES).nullable(),
  intelligenceStatus: z.enum(INTELLIGENCE_STATUSES),
  intelligenceUpdatedAt: z.string().nullable(),
}

export const CONVERSATION_STATES = ['open', 'archived', 'closed'] as const

export function conversationBase(h: ConversationHeader, waiting: boolean, intel: ConversationIntel | undefined) {
  const id = Number(h.id)
  return {
    conversationId: id,
    channel: CONVERSATION_CHANNEL,
    url: conversationUrl(id),
    state: oneOf(CONVERSATION_STATES, h.state) ?? 'open',
    lastMessageAt: iso(h.lastMessageAt),
    lastInboundAt: iso(h.lastInboundAt),
    waitingForReply: waiting,
    ...intelOf(intel),
  }
}

export const conversationBaseShape = {
  conversationId: z.number().int(),
  channel: z.literal(CONVERSATION_CHANNEL),
  url: z.string(),
  state: z.enum(CONVERSATION_STATES),
  lastMessageAt: z.string().nullable(),
  lastInboundAt: z.string().nullable(),
  waitingForReply: z.boolean(),
  ...intelShape,
}

export const MESSAGE_AUTHORS = ['customer', 'business', 'automation'] as const

export function presentMessage(m: McpMessageRow) {
  const author: (typeof MESSAGE_AUTHORS)[number] =
    m.direction === 'inbound' ? 'customer' : m.source === AUTO_RESPONSE_SOURCE ? 'automation' : 'business'
  return {
    messageId: Number(m.id),
    author,
    type: m.type,
    sentAt: iso(m.occurredAt),
    ...messageText(m.type, m.text),
  }
}

export const messageShape = z.object({
  messageId: z.number().int(),
  author: z.enum(MESSAGE_AUTHORS),
  type: z.string(),
  sentAt: z.string().nullable(),
  text: z.string().nullable(),
  contentTruncated: z.boolean(),
})
