/**
 * Notification copy — deterministic Hebrew string builders. Spec §5, §11.
 *
 * THREE HARD RULES, all enforced by unit tests (spec §22.1):
 *
 * 1. NO LLM EVER TOUCHES THIS FILE'S OUTPUT. Every string is assembled from CRM
 *    facts by pure functions. Care-charter Law 1: the model may rephrase inside
 *    the assistant surfaces, but a notification states a business fact, and a
 *    single fabricated fact discovered once ends the relationship.
 * 2. NO EMOJI (CLAUDE.md §12). Priority and category are conveyed by the
 *    existing Icon system and by text.
 * 3. NO SHAME (Law 13). An overdue follow-up reads "מעקב ממתין", never
 *    "פספסת" or a neglect count. The system absorbs anxiety; it never
 *    manufactures it.
 *
 * Pure and synchronous: no I/O, no randomness, no clock reads. The same context
 * always produces the same string, which is what makes collapse comparisons and
 * tests meaningful.
 *
 * Terminology (Law 8): ליד / לידים / נציג / סטטוס. Never לקוח, never סוכן.
 */

import type { EventContext } from './types'

/**
 * A trailing " — name" suffix, or nothing at all when the emission site did not
 * carry a name. An absent name is never replaced by a guess or a placeholder;
 * the notification is simply less specific (Law 1, Law 2).
 */
function withName(base: string, ctx: EventContext): string {
  const name = ctx.payload.leadName?.trim()
  return name ? `${base} — ${name}` : base
}

/**
 * Provider display names. Mirrors the Hebrew the integrations settings page
 * already shows, and falls back to the raw key rather than inventing a label
 * for a provider this map has not been taught.
 */
const PROVIDER_LABEL: Record<string, string> = {
  facebook: 'פייסבוק',
  whatsapp: 'WhatsApp',
}

function providerLabel(ctx: EventContext): string | null {
  const key = ctx.payload.provider?.trim()
  if (!key) return null
  return PROVIDER_LABEL[key] ?? key
}

function forProvider(withLabel: (label: string) => string, fallback: string, ctx: EventContext): string {
  const label = providerLabel(ctx)
  return label ? withLabel(label) : fallback
}

export const leadCreatedTitle = (ctx: EventContext): string => withName('ליד חדש', ctx)
export const leadHotTitle = (ctx: EventContext): string => withName('ליד חם', ctx)
/**
 * Two outcomes, two sentences, both stating only what happened. A questionnaire
 * that stopped early is not a failure to report back to the rep; it is a lead
 * with some answers on it and a person now expected.
 */
export const leadQuestionnaireHandoffTitle = (ctx: EventContext): string =>
  withName(ctx.payload.complete === true ? 'שאלון הושלם' : 'פנייה ממתינה לנציג', ctx)

export const leadAssignedTitle = (ctx: EventContext): string => withName('ליד שויך אליך', ctx)
/**
 * Counted, never guessed: the number comes from the emission site (Law 1). With
 * no count the phrasing degrades to the name-free form rather than inventing one.
 */
export const leadsBulkAssignedTitle = (ctx: EventContext): string => {
  const n = ctx.payload.assignedCount ?? 0
  if (n <= 0) return 'לידים שויכו אליך'
  if (n === 1) return 'ליד שויך אליך'
  return `${n} לידים שויכו אליך`
}

export const leadActivityTitle = (ctx: EventContext): string => withName('פעילות חדשה בליד', ctx)

/**
 * AI insight copy — DETERMINISTIC, exactly like every other builder here.
 *
 * The model's own headline is stored on `ai_insights` and read on the ליד page.
 * What INTERRUPTS the rep is system-authored: the same restrained Hebrew shape
 * every other notification uses, so the bell never carries model prose and never
 * carries urgency the model chose. Terminology per ux-guidelines §6 — ליד, never
 * לקוח — and no emoji, no drama, no blame (care-charter Law 8, 13, 17).
 */
export const insightSurfacedTitle = (ctx: EventContext): string => withName('כדאי לחזור לליד', ctx)
export const insightSurfacedBody = (): string => 'נמצא משהו שכדאי לבדוק. פתח את הליד לפרטים.'

/**
 * Deliberately does NOT name the new status.
 *
 * The lead-status vocabulary lives inline in `components/clients/clientForm.tsx`
 * — there is no shared status→Hebrew map in the codebase. Copying those five
 * labels here would create a second source of truth for status wording, which
 * drifts the first time one is renamed. The lead's name plus a deep link to the
 * lead answers "what changed and where" without duplicating that vocabulary.
 */
export const leadStatusChangedTitle = (ctx: EventContext): string => withName('סטטוס עודכן', ctx)

export const messageInboundTitle = (ctx: EventContext): string => withName('הודעה חדשה', ctx)

/** The count comes from the row's own groupCount — never recomputed, never estimated. */
export const messageInboundMultipleTitle = (ctx: EventContext): string =>
  withName(`${Math.max(ctx.groupCount, 2)} הודעות חדשות`, ctx)

/** The AI told the customer a person will answer. Says only that; no customer text. */
export const leadHandoffTitle = (ctx: EventContext): string => withName('פנייה ממתינה לנציג', ctx)
export const messageUnansweredTitle = (ctx: EventContext): string => withName('הודעה ממתינה למענה', ctx)

/**
 * Messenger — one open row per conversation that counts its arrivals. The count
 * is the row's own groupCount, never recomputed. The sender's name comes from the
 * Messenger profile or the linked ליד; absent ⇒ name-free, never guessed.
 *
 * WORD ORDER IS LOAD-BEARING (right-to-left rendering). "Messenger" sits BETWEEN
 * Hebrew words, so the text before " — " ends in Hebrew. "הודעה חדשה ב-Messenger —
 * Almayo Mekonen" let the Latin brand, the dash and a Latin name fuse into one
 * left-to-right run, which rendered as "Messenger — Almayo Mekonen-הודעה חדשה ב".
 */
export const messengerInboundTitle = (ctx: EventContext): string =>
  withName(ctx.groupCount > 1 ? `${ctx.groupCount} הודעות Messenger חדשות` : 'הודעת Messenger חדשה', ctx)

/**
 * Facebook Page comment — author display name is carried in `leadName` at the
 * emit site (there is no Lead yet). Absent name ⇒ less specific, never guessed.
 */
export const commentReceivedTitle = (ctx: EventContext): string => withName('תגובה חדשה', ctx)

export const followupDueTitle = (ctx: EventContext): string => withName('מעקב מתוכנן להיום', ctx)

/** "ממתין", never "באיחור"/"פספסת" — recovery framing, not failure (Law 13). */
export const followupOverdueTitle = (ctx: EventContext): string => withName('מעקב ממתין', ctx)

export const integrationDisconnectedTitle = (ctx: EventContext): string =>
  forProvider((l) => `החיבור ל${l} נותק`, 'חיבור נותק', ctx)

export const integrationDisconnectedBody = (): string => 'נדרש חיבור מחדש בהגדרות'

export const integrationErrorTitle = (ctx: EventContext): string => forProvider((l) => `תקלה בחיבור ל${l}`, 'תקלה בחיבור', ctx)

export const integrationIngestionFailedTitle = (): string => 'ליד לא נשמר'

export const integrationIngestionFailedBody = (ctx: EventContext): string =>
  forProvider((l) => `הגיע ליד מ${l} שלא נשמר במערכת`, 'הגיע ליד שלא נשמר במערכת', ctx)

/**
 * Placeholder copy for the two registered-but-DISABLED sla.* types (spec §4.5).
 *
 * SLA has no definition anywhere in this codebase — no table, no config, no
 * timer, no product decision. Writing real copy here would be inventing the
 * semantics the spec explicitly refuses to invent, because copy like "זמן
 * התגובה חלף" asserts that a response window exists and has a length.
 *
 * These entries exist ONLY so a future SLA system plugs into the registry
 * without an engine change; that system defines its own copy when it defines
 * its own meaning. Unreachable today: `enabled: false` and no emitter, asserted
 * by registry invariant tests.
 */
export const SLA_PLACEHOLDER_TITLE = 'SLA'
export const slaPlaceholderTitle = (): string => SLA_PLACEHOLDER_TITLE

/**
 * Platform-operator copy for a cancellation that still needs handling at the
 * payment provider.
 *
 * IT STATES AN INSTRUCTION, NEVER AN OUTCOME. SocialCRM has no way to stop a
 * Grow standing order — there is no documented cancellation API and no outbound
 * Grow client — so the only verified facts are that the customer cancelled here
 * and that the mandate is still standing. "יש לבטל" is a task; anything in the
 * past tense about Grow would be a claim this system cannot make (care-charter
 * Law 1), which is the same defect already corrected in the customer-facing
 * cancellation copy.
 *
 * Not a customer-facing surface: the reader is whoever runs SocialCRM, so the
 * subject is the agency by name. An absent name degrades to a name-free
 * sentence rather than a placeholder, exactly like every other builder here.
 */
export const subscriptionCancellationTitle = (): string => 'ביטול מנוי דורש טיפול'

export const subscriptionCancellationBody = (ctx: EventContext): string => {
  const name = ctx.payload.cancellingAgencyName?.trim()
  const subject = name ? `${name} ביטל` : 'עסק ביטל'
  return `${subject} את מנוי SocialCRM. יש לבטל את הוראת הקבע שלו ב-Grow.`
}

/** No body for the common case — a title plus a deep link is the whole message. */
export const conversationPersonalTitle = (ctx: EventContext): string => withName('המענה האוטומטי עונה בשיחה אישית', ctx)
export const noBody = (): null => null
