import 'server-only'
import { createHash } from 'node:crypto'
import { db } from '@/config/db'
import { getAgencyName, getAgencyReplyTo } from '@/db/automations/leadFacts'
import { isEmailBlocked, normalizeEmail } from '@/db/automations/emailBlocks'
import { isLeadSuppressed } from '@/db/automations/suppressions'
import { isCustomerOptedOut } from '@/db/whatsappOptOuts'
import { claimQuoteInvitation, markInvitationFailed, markInvitationSent, markInvitationUnknown, type InvitationRow } from '@/db/quotes/invitations'
import { getAutomationsFrom } from '@/lib/automations/flags'
import { isValidReplyTo, resolveSenderIdentity, type SenderIdentity } from '@/lib/automations/identity'
import { renderAutomationEmail } from '@/lib/automations/renderEmail'
import { leadUnsubscribeUrl } from '@/lib/automations/unsubscribeToken'
import { isWaAssistantQuotesEmailInviteAgency } from '@/lib/flags/waAssistantFlags'
import { quoteLinkExpiry, QUOTE_LINK_TTL_MS } from '@/lib/quotes/deliveryLink'
import { hashInvitationRef, invitationPrefill, newInvitationRef, whatsappClickToChat } from '@/lib/quotes/invitationRef'
import { fetchBusinessDisplayNumber } from '@/lib/whatsapp/businessDisplayNumber'
import type { WhatsappOutboundTarget } from '@/lib/inbox/whatsappOutboundTarget'
import { businessDateString } from '@/lib/today/time'
import { baseUrl } from '@/types/vars'

/**
 * The third way to a customer, after WhatsApp text and the approved template:
 * an EMAIL that invites the lead to write to the business on WhatsApp. It never
 * carries the quote, its number, its amount, a link to the PDF or any CRM id; it
 * carries a wa.me link whose pre-filled message holds an opaque reference
 * (lib/quotes/invitationRef.ts). The quote itself goes out only on WhatsApp,
 * after the customer has pressed Send (./invitationReply.ts).
 *
 * Runs only inside the `send_quote` executor, after the owner's tap, with the
 * email hash the card bound. Same sender identity, unsubscribe link, block list
 * and suppression list as the customer-automation email (lib/automations).
 */

/** At most 30 days after the approval, and never past the quote's own validity. */
export const INVITE_AUTHORIZATION_MS = QUOTE_LINK_TTL_MS

export const emailHashOf = (email: string) => createHash('sha256').update(normalizeEmail(email)).digest('hex')

export const maskedEmail = (email: string) => {
  const [local, domain] = normalizeEmail(email).split('@')
  return `${local.slice(0, 1)}***@${domain}`
}

/** The lead's address, when an email may go to it: valid, never hard-bounced, never unsubscribed. */
export async function leadInviteEmail(agencyId: number, leadId: number): Promise<string | null> {
  const row = (await db('clients').where({ id: leadId, agencyId }).first('email')) as { email: string | null } | undefined
  const email = normalizeEmail(row?.email ?? '')
  if (!isValidReplyTo(email)) return null
  if (await isEmailBlocked(agencyId, email)) return null
  if (await isLeadSuppressed(agencyId, leadId)) return null
  return email
}

async function senderIdentity(agencyId: number): Promise<SenderIdentity | null> {
  return resolveSenderIdentity({ agencyName: await getAgencyName(agencyId), replyTo: await getAgencyReplyTo(agencyId) }, getAutomationsFrom()).identity
}

/** For the card: whether an invitation could go out, and to which address (shown masked to the owner). */
export async function inviteAvailability(agencyId: number, leadId: number): Promise<{ email: string; emailHash: string } | null> {
  if (!isWaAssistantQuotesEmailInviteAgency(agencyId)) return null
  const email = await leadInviteEmail(agencyId, leadId)
  if (!email || !(await senderIdentity(agencyId))) return null
  return { email, emailHash: emailHashOf(email) }
}

export const INVITE_EMAIL = {
  subject: 'הצעת המחיר שלך מוכנה',
  body: [
    'שלום,',
    'הכנו עבורך הצעת מחיר.',
    'כדי לקבל אותה, לחצו על הכפתור למטה. תיפתח שיחה בוואטסאפ עם {{שם העסק}}, ובה הודעה מוכנה מראש.',
    'ההצעה תישלח אליכם בוואטסאפ רק אחרי שתלחצו "שליחה" על ההודעה הזו.',
  ].join('\n\n'),
  cta: 'פתיחת שיחה בוואטסאפ',
} as const

export type InviteArgs = { quoteId: number; version: number; documentId: number; contentHash: string; leadId: number; customerPhoneE164: string; businessPhoneNumberId: string; customerEmailHash: string }

export type InviteOutcome =
  | { kind: 'invited'; invitationId: number; repeated: boolean }
  | { kind: 'invite_duplicate'; invitation: InvitationRow }
  | { kind: 'invite_unavailable'; code: 'disabled' | 'opted_out' | 'rate_limited' | 'no_email' | 'email_changed' | 'no_sender' | 'no_business_number' }
  | { kind: 'invite_failed'; code: string }
  | { kind: 'invite_unknown' }
  | { kind: 'delivery_live' }
  | { kind: 'stale'; reason: string }

export type InviteDeps = {
  send?: (args: { from: string; replyTo: string; to: string; subject: string; html: string; text: string; headers: Record<string, string>; idempotencyKey: string }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
  displayNumber?: (phoneNumberId: string, accessToken: string) => Promise<string | null>
}

export async function inviteByEmail(input: { agencyId: number; userId: number; actionId: string; args: InviteArgs; target: WhatsappOutboundTarget; expiresOn: string | null; nowMs: number; deps?: InviteDeps }): Promise<InviteOutcome> {
  const { agencyId, userId, actionId, args, target, nowMs } = input
  if (!isWaAssistantQuotesEmailInviteAgency(agencyId)) return { kind: 'invite_unavailable', code: 'disabled' }

  // An invitation to WhatsApp is still a message about WhatsApp: never to a customer who asked us to stop.
  if (await isCustomerOptedOut(agencyId, args.customerPhoneE164)) return { kind: 'invite_unavailable', code: 'opted_out' }
  const email = await leadInviteEmail(agencyId, args.leadId)
  if (!email) return { kind: 'invite_unavailable', code: 'no_email' }
  // The address the owner approved, and no other: an edited email needs a new approval.
  if (emailHashOf(email) !== args.customerEmailHash) return { kind: 'invite_unavailable', code: 'email_changed' }
  const identity = await senderIdentity(agencyId)
  if (!identity) return { kind: 'invite_unavailable', code: 'no_sender' }
  const display = await (input.deps?.displayNumber ?? fetchBusinessDisplayNumber)(target.businessPhoneNumberId, target.accessToken)
  const ref = newInvitationRef()
  const link = display ? whatsappClickToChat(display, invitationPrefill(ref)) : null
  if (!link) return { kind: 'invite_unavailable', code: 'no_business_number' }

  const claim = await claimQuoteInvitation({
    agencyId,
    quoteId: args.quoteId,
    quoteVersion: args.version,
    documentId: args.documentId,
    contentHash: args.contentHash,
    actionId,
    leadId: args.leadId,
    approvedByUserId: userId,
    customerPhoneE164: args.customerPhoneE164,
    businessPhoneNumberId: args.businessPhoneNumberId,
    emailHash: args.customerEmailHash,
    refHash: hashInvitationRef(ref),
    authorizationExpiresAt: new Date(Math.min(nowMs + INVITE_AUTHORIZATION_MS, quoteLinkExpiry(input.expiresOn, nowMs).getTime())),
    businessDate: businessDateString(nowMs),
  })
  if (claim.kind === 'duplicate') {
    if (claim.invitation.actionId !== actionId) return { kind: 'invite_duplicate', invitation: claim.invitation }
    if (claim.invitation.state === 'failed') return { kind: 'invite_failed', code: claim.invitation.failureCode ?? 'failed' }
    if (claim.invitation.state === 'sending' || claim.invitation.state === 'unknown') return { kind: 'invite_unknown' }
    return { kind: 'invited', invitationId: claim.invitation.id, repeated: true }
  }
  if (claim.kind === 'delivery_live') return claim
  if (claim.kind === 'rate_limited') return { kind: 'invite_unavailable', code: 'rate_limited' }
  if (claim.kind === 'stale') return claim

  const marks = { invitationId: claim.invitationId, agencyId, quoteId: args.quoteId, quoteVersion: args.version, userId, actionId }
  const unsubscribe = leadUnsubscribeUrl(baseUrl, agencyId, args.leadId)
  const rendered = await renderAutomationEmail({ subject: INVITE_EMAIL.subject, body: INVITE_EMAIL.body, vars: { businessName: identity.displayName } as never, unsubscribeUrl: unsubscribe, action: { label: INVITE_EMAIL.cta, url: link } })
  const send =
    input.deps?.send ??
    (async (a: Parameters<NonNullable<InviteDeps['send']>>[0]) => {
      const { sendEmail } = await import('@/lib/email/sender')
      return sendEmail(a)
    })
  const sent = await send({
    from: identity.from,
    replyTo: identity.replyTo,
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    // One invitation row, one email: a retry of this request is the same email to Resend.
    idempotencyKey: `quote-invite/${agencyId}/${claim.invitationId}`,
  }).catch(() => null)

  if (sent === null) {
    await markInvitationUnknown(marks)
    return { kind: 'invite_unknown' }
  }
  if (sent.ok === false) {
    await markInvitationFailed({ ...marks, code: 'email_rejected' })
    return { kind: 'invite_failed', code: 'email_rejected' }
  }
  await markInvitationSent({ ...marks, providerMessageId: sent.id })
  return { kind: 'invited', invitationId: claim.invitationId, repeated: false }
}
