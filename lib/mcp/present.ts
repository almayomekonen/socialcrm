import { z } from 'zod'
import { leadUrl } from '@/lib/oauth/server/config'
import { STATUS_STYLES } from '@/lib/leads/statusStyles'
import { leadSourceChannel } from '@/lib/leads/leadSourceLabel'

/**
 * How MCP tools present leads to an assistant. Vendor-neutral: every MCP client
 * (Claude, ChatGPT, future ones) gets the same shapes.
 *
 * PII boundary (Phase A, D4): no phone, email, WhatsApp id or other contact
 * identifier is ever selected for output. Free text that people typed (names,
 * follow-up notes) is additionally scrubbed of phone- and email-shaped
 * substrings, because a rep can type a number into a note or a name.
 */

/** The only statuses SocialCRM has. Anything else (legacy 'true', null) → null. */
export const LEAD_STATUSES = ['new', 'contacted', 'interested', 'closed', 'lost'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

export function statusOf(v: unknown): LeadStatus | null {
  return typeof v === 'string' && (LEAD_STATUSES as readonly string[]).includes(v) ? (v as LeadStatus) : null
}

/** Hebrew label from the product's own status table; null for an unknown status. */
export function statusLabelOf(s: LeadStatus | null): string | null {
  return s ? (STATUS_STYLES[s]?.label ?? null) : null
}

export const CONTACT_DETAILS_UNAVAILABLE = 'unavailable' as const
export const CONTACT_DETAILS_NOTE =
  'Phone numbers and email addresses are intentionally not shared through this connection. Open the lead in SocialCRM to see or use them.'

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g
// 9+ digits (the shortest Israeli number with area code, e.g. 03-5551234),
// optionally separated by spaces, dots, dashes, slashes or brackets, optional
// leading +. 9, not 7: a plain date (2026-10-04, 8 digits) stays readable.
const PHONE_RE = /\+?\(?\d(?:[\s.\-/()]*\d){8,}/g
// C0/C1 control characters except tab and newline.
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g

/** Replace phone- and email-shaped substrings. */
export function scrubContactPatterns(s: string): string {
  return s.replace(EMAIL_RE, '[email hidden]').replace(PHONE_RE, '[phone hidden]')
}

/**
 * Text written by customers or reps: returned as DATA, never interpreted.
 * Control characters removed, contact patterns scrubbed, length capped.
 */
export function untrustedText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = scrubContactPatterns(v.replace(CONTROL_RE, '')).trim()
  if (!s) return null
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export function iso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function personName(first: unknown, last: unknown): string | null {
  const joined = [first, last].filter((x) => typeof x === 'string' && x.trim()).join(' ')
  return untrustedText(joined, 120)
}

/** The fields every lead in every tool output carries. */
export type LeadRef = {
  leadId: number
  name: string | null
  url: string
  contactDetails: typeof CONTACT_DETAILS_UNAVAILABLE
}

export function leadRef(id: number, name: string | null): LeadRef {
  return { leadId: id, name, url: leadUrl(id), contactDetails: CONTACT_DETAILS_UNAVAILABLE }
}

/** Zod shapes for tool outputs (validated by the SDK before a result is sent). */
export const leadRefShape = {
  leadId: z.number().int(),
  name: z.string().nullable(),
  url: z.string(),
  contactDetails: z.literal(CONTACT_DETAILS_UNAVAILABLE),
}
export const statusShape = {
  status: z.enum(LEAD_STATUSES).nullable(),
  statusLabel: z.string().nullable(),
}

export const LEAD_SOURCE_CHANNELS = ['whatsapp', 'facebook', 'instagram', 'website', 'manual', 'other'] as const

/** Channel only — the stored composite `channel:externalId` suffix is never exposed. */
export function sourceChannelOf(v: unknown): (typeof LEAD_SOURCE_CHANNELS)[number] {
  return leadSourceChannel(typeof v === 'string' ? v : null) ?? 'other'
}
