import { getProductTopic } from '@/lib/agent/product/knowledge'
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

export const APP_ORIGIN = 'https://getsocialcrm.com'
export const APP_LINK = `${APP_ORIGIN}/agent`
/** Where an owner connects this phone (the code is issued there, in their own logged-in session). */
export const CONNECT_LINK = `${APP_ORIGIN}/settings/whatsapp_reminders`
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

/** Letters and digits only, for "does the headline already say this?". */
const squash = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '')

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
 * The reply to one validated, answered investigation, and the headline kept as
 * the next turn's history (`null` keeps none). The worker's only answer path,
 * pure so the WhatsApp eval drives exactly what the owner receives.
 *
 * THE SHAPE FOLLOWS THE ANSWER. Only an answer that carries business claims is a
 * report (bold headline, bullets, the app link). An answer with no claims — a
 * greeting, a thanks, a clarifying question, an honest "I can't tell" — is sent
 * as the plain sentence the model wrote. Replacing it with COPY.noAnswer was the
 * "אלוף" defect: the validator had accepted it (a claim that was never proposed
 * cannot be unsupported), and the worker threw it away. The same rule discarded
 * every claimless clarifying question in the meeting flow, and with it the
 * history line the next turn needed. COPY.noAnswer stays for an answer with
 * nothing in it at all.
 *
 * A product answer (PRODUCT claims only) is plain too, and links the one screen
 * it is about (`productLink`) instead of the Agent page — or none.
 */
export function replyForAnswer(
  answer: AgentAnswer,
  opts: { note?: string | null } = {},
): { text: string; headline: string | null } {
  const claims = answer.claims ?? []
  const headline = clean(answer.headline || '')
  const unknown = answer.unknown ? clean(answer.unknown) : ''

  if (claims.length === 0) {
    if (!headline && !unknown) return { text: fitReply(COPY.noAnswer, opts.note), headline: null }
    return { text: fitReply([headline, unknown].filter(Boolean).join('\n\n'), opts.note), headline: headline || unknown }
  }

  if (claims.every((c) => c.claimClass === 'PRODUCT')) {
    const route = productLink(claims)
    // A claim the headline already says in full is not sent twice.
    const said = squash(headline)
    const body = claims.map((c) => clean(c.text)).filter((t) => t && !said.includes(squash(t)))
    const lines = [headline, ...body.slice(0, MAX_CLAIMS), unknown].filter(Boolean)
    if (route) lines.push(`במערכת: ${APP_ORIGIN}${route}`)
    return { text: fitReply(lines.join('\n\n'), opts.note), headline: headline || 'תשובה' }
  }

  return renderAnswer(answer, opts)
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
  /**
   * Sender guidance (senderGuidance.ts). Each is the SAME text for every sender
   * in its case, so it never says whether a number belongs to anyone.
   */
  notConnected:
    'כאן העוזר של SocialCRM. כדי לשאול אותי על העסק שלך, צריך לחבר את המספר הזה לחשבון שלך ב-SocialCRM, בהגדרות ← תזכורות בוואטסאפ: ' +
    CONNECT_LINK,
  abuseBurst: 'קיבלתי הרבה הודעות בתוך דקה, אז עצרתי לרגע כהגנה מפני הצפה. אפשר להמשיך בעוד דקה.',
  abuseHourly: 'קיבלתי מספר חריג של הודעות בשעה האחרונה, אז עצרתי זמנית כהגנה מפני הצפה. אפשר להמשיך מאוחר יותר.',
  abuseLoop: 'קיבלתי את אותה הודעה כמה פעמים ברצף, אז עצרתי כדי למנוע לולאה. אפשר לשלוח הודעה אחרת.',
  consentRequired:
    'כדי לשוחח איתי כאן, צריך קודם לאשר שיחות עם העוזר בחשבון שלך ב-SocialCRM, בהגדרות ← תזכורות בוואטסאפ: ' + CONNECT_LINK,
  severalAccounts:
    'המספר הזה מחובר לכמה חשבונות ב-SocialCRM, ולכן אין לי דרך לדעת על איזה עסק לענות. כדי לשאול אותי כאן, צריך להשאיר אותו מחובר לחשבון אחד בלבד, בהגדרות ← תזכורות בוואטסאפ: ' +
    CONNECT_LINK,
} as const

/**
 * The screen a product answer links to: the `link` of the topic the answer is
 * about. Each claim votes once for the screen of each topic it cites; the
 * screen with the most votes wins, and a tie — an answer split evenly between
 * screens — links nothing rather than guess. A topic without a `link` (one that
 * is not about a single screen) never votes.
 */
export function productLink(claims: AgentAnswer['claims']): string | null {
  const votes = new Map<string, number>()
  for (const c of claims) {
    if (c.claimClass !== 'PRODUCT') continue
    const links = new Set(c.productEvidence.map((id) => getProductTopic(id)?.link).filter((l): l is string => !!l))
    for (const l of links) votes.set(l, (votes.get(l) ?? 0) + 1)
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1])
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) return null
  return ranked[0][0]
}

/** The reply when the investigation itself did not produce an answer. */
export function failureReply(reason: string): string {
  return reason === 'deadline' ? COPY.timeout : reason === 'gate_denied' ? COPY.notAvailable : COPY.failed
}

/** The model may propose actions; this phase never performs them, and says so instead of implying it. */
export const NO_ACTIONS_NOTE = 'בשלב הזה אני רק עונה על שאלות ולא מבצע פעולות. אפשר לבצע את זה ב-SocialCRM: ' + APP_LINK

/** Refusals that may be answered (the fixed copy reveals nothing); the rest are silent. */
export function refusalReply(reason: string): string | null {
  switch (reason) {
    case 'no_product_access':
    case 'agent_not_enabled':
      return COPY.notAvailable
    case 'consent_required':
      return COPY.consentRequired
    case 'sender_limit':
      return COPY.senderLimit
    case 'agency_limit':
    case 'spend_limit':
      return COPY.agencyLimit
    // Technical abuse protection (founder entitlement): the reason, never a payment.
    case 'abuse_burst':
      return COPY.abuseBurst
    case 'abuse_hourly':
      return COPY.abuseHourly
    case 'abuse_loop':
      return COPY.abuseLoop
    default:
      // Not this assistant's user any more (flag off, recipient inactive,
      // ambiguous number, user suspended): no reply, so nothing about the
      // account is confirmed to whoever holds the phone.
      return null
  }
}
