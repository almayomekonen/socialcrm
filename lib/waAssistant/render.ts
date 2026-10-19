import type { AgentAnswer } from '@/lib/agent/types'
import { MAX_REPLY_CHARS } from '@/lib/whatsapp/platform/sendText'

/**
 * The WhatsApp reply, built only from a VALIDATED Agent answer
 * (lib/agent/validate.ts has already dropped every claim whose evidence did not
 * resolve) or from the fixed copy below. Pure.
 *
 * Three rules hold for every string this returns:
 *   - it never says anything was done: this phase has no write tools, and any
 *     proposal in the answer is ignored (the caller never submits it);
 *   - no customer phone number or email survives (`redactContactDetails`), even
 *     if one appeared in a lead name or a summary;
 *   - it fits one WhatsApp message.
 */

export const APP_LINK = 'https://getsocialcrm.com/agent'
const MAX_CLAIMS = 6

/** Phone-like runs (9+ digits, with the separators people type) and emails. */
export function redactContactDetails(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[מוסתר]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[מוסתר]' : m))
}

function clean(text: string): string {
  return redactContactDetails(text.replace(/\s+/g, ' ').trim())
}

/**
 * `body`, then `note` (when given), within MAX_REPLY_CHARS. The note's room is
 * reserved FIRST and only the body is cut, so the payload's own trim
 * (sendText.ts) can never remove the note.
 */
export function fitReply(body: string, note?: string | null): string {
  const suffix = note ? `\n\n${note}` : ''
  const room = MAX_REPLY_CHARS - suffix.length
  const fitted = body.length > room ? `${body.slice(0, room - 1)}…` : body
  return fitted + suffix
}

export function renderAnswer(answer: AgentAnswer, opts: { note?: string | null } = {}): { text: string; headline: string } {
  const headline = clean(answer.headline || '')
  const lines: string[] = []
  if (headline) lines.push(`*${headline}*`)
  const claims = (answer.claims ?? []).map((c) => clean(c.text)).filter(Boolean).slice(0, MAX_CLAIMS)
  if (claims.length) lines.push('', ...claims.map((c) => `• ${c}`))
  if (answer.unknown) lines.push('', clean(answer.unknown))
  lines.push('', `לפרטים המלאים: ${APP_LINK}`)
  return { text: fitReply(lines.join('\n'), opts.note), headline: headline || 'תשובה' }
}

/**
 * Fixed replies. None carries CRM data, so each is safe to send even when the
 * reason is that the sender may no longer read that data.
 */
export const COPY = {
  unsupported: 'כרגע אני מבין רק הודעות טקסט. אפשר לכתוב לי, למשל: "סכם לי את היום" או "מי לא קיבל מענה?"',
  emptyQuestion: 'במה אפשר לעזור? אפשר לשאול, למשל: "סכם לי את היום", "מי לא קיבל מענה?" או "מה הסטטוס של הליד דניאל?"',
  senderLimit: 'הגעת למספר ההודעות המרבי לשעה הקרובה. אפשר להמשיך ב-SocialCRM: ' + APP_LINK,
  agencyLimit: 'העוזר הגיע למגבלת השימוש היומית של החשבון. אפשר להמשיך ב-SocialCRM: ' + APP_LINK,
  notAvailable: 'העוזר אינו זמין כרגע לחשבון הזה. אפשר להמשיך ב-SocialCRM: ' + APP_LINK,
  timeout: 'לקח לי יותר מדי זמן לבדוק את זה. אפשר לנסות שוב בניסוח קצר יותר, או להמשיך ב-SocialCRM: ' + APP_LINK,
  failed: 'לא הצלחתי להשלים את הבדיקה הפעם. אפשר לנסות שוב בעוד רגע, או להמשיך ב-SocialCRM: ' + APP_LINK,
  noAnswer: 'לא מצאתי במערכת מספיק נתונים כדי לענות על זה בוודאות. אפשר לנסח אחרת, למשל עם שם הליד המלא.',
} as const

/** The model may propose actions; this phase never performs them, and says so instead of implying it. */
export const NO_ACTIONS_NOTE = 'בשלב הזה אני רק עונה על שאלות ולא מבצע פעולות. אפשר לבצע את זה ב-SocialCRM: ' + APP_LINK

/** Refusals that may be answered (the fixed copy reveals nothing); the rest are silent. */
export function refusalReply(reason: string): string | null {
  switch (reason) {
    case 'no_product_access':
    case 'agent_not_enabled':
      return COPY.notAvailable
    case 'sender_limit':
      return COPY.senderLimit
    case 'agency_limit':
    case 'spend_limit':
      return COPY.agencyLimit
    default:
      // Not this assistant's user any more (flag off, recipient inactive,
      // ambiguous number, user suspended): no reply, so nothing about the
      // account is confirmed to whoever holds the phone.
      return null
  }
}
