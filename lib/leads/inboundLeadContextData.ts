import { getUser } from '@/db/auth'
import { listConversationMessages } from '@/db/inboxMessages'
import { getInboxConversationByLeadId } from '@/modules/inbox/queries'
import { CAPTURED_FIELD_LABELS } from './inboundLeadCopy'
import { formAnswersForLead } from '@/db/leadFormAnswers'
import { displayableFormAnswers, formAnswerLabel } from '@/lib/facebook/leadFormAnswers'

/**
 * Shared data helpers for the inbound-lead context surface.
 *
 * Desktop `InboundLeadContext` and the mobile provenance card both consume
 * these. Presentation stays in each view — this file does not render.
 */

// Ingestion injects this literal when the Facebook form carried no name
// (lib/adapters/facebookLead.ts) — treat it as "no name captured", not a real one.
export const FB_NAME_PLACEHOLDER = 'ליד מפייסבוק'

/**
 * SocialCRM's capture time in the business timezone (Asia/Jerusalem), pinned
 * explicitly so it is correct on Vercel's UTC runtime and deterministic. Mirrors
 * `formatDateTime` (he-IL short date+time, dots→slashes) but timezone-safe.
 */
export function formatCaptureAt(date: Date | string | null | undefined): string | null {
  if (!date) return null
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Jerusalem',
  })
    .format(d)
    .replaceAll('.', '/')
}

export function facebookFieldPresence(input: {
  firstName?: string | null
  lastName?: string | null
  phone?: string | null
  email?: string | null
}): { hasName: boolean; hasPhone: boolean; hasEmail: boolean } {
  const hasName = !!(
    input.lastName?.trim() ||
    (input.firstName?.trim() && input.firstName.trim() !== FB_NAME_PLACEHOLDER)
  )
  return {
    hasName,
    hasPhone: !!input.phone?.trim(),
    hasEmail: !!input.email?.trim(),
  }
}

export function facebookCapturedFieldLabels(
  hasName?: boolean,
  hasPhone?: boolean,
  hasEmail?: boolean,
): string[] {
  return [
    hasName && CAPTURED_FIELD_LABELS.name,
    hasPhone && CAPTURED_FIELD_LABELS.phone,
    hasEmail && CAPTURED_FIELD_LABELS.email,
  ].filter(Boolean) as string[]
}

/**
 * WhatsApp first-inbound preview + conversation id for a lead.
 *
 * Same agency-scoped reads the desktop summary already uses. Inbox failure
 * degrades to copy-only and NEVER throws to the lead page.
 */
export async function loadWhatsAppInboundPreview(
  leadId: number,
): Promise<{ conversationId: number | null; preview: string | null }> {
  try {
    const user = await getUser()
    if (!user?.agencyId) return { conversationId: null, preview: null }

    const conv = await getInboxConversationByLeadId(user.agencyId, leadId)
    if (!conv?.conversationId) return { conversationId: null, preview: null }

    const messages = await listConversationMessages(conv.conversationId)
    const firstInbound = messages.find(
      (m) => m.direction === 'inbound' && typeof m.text === 'string' && m.text.trim().length > 0,
    )
    return {
      conversationId: conv.conversationId,
      preview: firstInbound ? firstInbound.text.trim() : null,
    }
  } catch (err) {
    console.error('[InboundLeadContext] inbox read failed; showing copy only', { leadId, err: String(err) })
    return { conversationId: null, preview: null }
  }
}

/** One row of "תשובות מהטופס": the question as the owner reads it, and the answer(s). */
export type FormAnswerRow = { label: string; values: string[] }

/**
 * The Lead Ads answers to show beside a Facebook / Instagram ליד — every
 * question except the contact details the lead already displays. Agency-scoped
 * through the session, like every read here; any failure shows nothing rather
 * than breaking the lead page. Leads created before answers were stored have
 * none.
 */
export async function loadLeadFormAnswers(leadId: number): Promise<FormAnswerRow[]> {
  try {
    const user = await getUser()
    if (!user?.agencyId) return []
    const answers = await formAnswersForLead(user.agencyId, leadId)
    return displayableFormAnswers(answers).map((a) => ({ label: formAnswerLabel(a.key), values: a.values }))
  } catch {
    return []
  }
}
