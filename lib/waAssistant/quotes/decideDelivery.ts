import 'server-only'
import { db } from '@/config/db'
import { decideOnAction } from '@/lib/agent/actions/bridge'
import { decideWaApproval, type WaApproval } from '@/db/waAssistantApprovals'
import { findQuoteDeliveryByAction } from '@/db/quotes/deliveries'
import { findInvitationByAction } from '@/db/quotes/invitations'
import { formatBusinessDate } from '@/lib/today/time'
import { recordQuoteEvent } from '@/db/quotes/events'
import { cancelQuoteSystem } from '@/db/quotes/cancelQuote'
import { canDraftQuote } from '@/lib/quotes/permissions'
import type { UserDb } from '@/db/auth'
import type { Roles } from '@/types/roles'
import { COPY } from '../render'
import type { AgentScope } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { MeetingReply } from '../meetings/types'
import { DELIVERY_COPY, maskedPhone, quoteEditedReply, quoteInvitedReply, quoteSentReply } from './deliveryCopy'
import { emailHashOf, maskedEmail } from './emailInvite'
import { startQuotePdf } from './pdfJob'
import { prepareQuoteSendCard } from './preview'

/**
 * A tap on a "send" or "apply this edit" card. Same path as every other card:
 * the token is consumed in one guarded statement (pending, unexpired, this
 * recipient), then the existing `decideOnAction` re-checks rollout, proposer and
 * argsHash, then the executor checks the world. No model runs here.
 */

const reply = (status: MeetingReply['status'], stopReason: string, text: string | null): MeetingReply => ({ status, stopReason, text, headline: null })

/** How the email-invitation fallback ended, for the owner who tapped. */
const INVITE_REASONS: Record<string, [MeetingReply['status'], string]> = {
  'quote-invite-already-sent': ['refused', DELIVERY_COPY.inviteAlready],
  'quote-invite-failed': ['failed', DELIVERY_COPY.inviteFailed],
  'quote-invite-unknown': ['failed', DELIVERY_COPY.inviteUnknown],
  'quote-invite-no-email': ['refused', DELIVERY_COPY.inviteNoEmail],
  'quote-invite-email-changed': ['refused', DELIVERY_COPY.inviteEmailChanged],
  'quote-invite-no-sender': ['refused', DELIVERY_COPY.inviteNoSender],
  'quote-invite-no-business-number': ['failed', DELIVERY_COPY.inviteNoBusinessNumber],
  'quote-invite-opted-out': ['refused', DELIVERY_COPY.optedOut],
  'quote-invite-rate-limited': ['refused', DELIVERY_COPY.inviteRateLimited],
  'quote-invite-disabled': ['refused', DELIVERY_COPY.windowClosedNoEmail],
}

/** No delivery behind a verified send: it was an email invitation, and the owner must read it as exactly that. */
async function invitedReply(agencyId: number, actionId: string, repeated: boolean): Promise<MeetingReply> {
  const inv = await findInvitationByAction(agencyId, actionId)
  if (!inv || !['sent', 'redeemed'].includes(inv.state)) return reply('failed', 'quote_send_unknown', DELIVERY_COPY.sendUnknown)
  if (repeated) return reply('answered', 'quote_invite_already', DELIVERY_COPY.inviteAlready)
  const [quote, lead] = await Promise.all([
    db('sales_quotes').where({ id: inv.quoteId, agencyId }).first('quoteNumber') as Promise<{ quoteNumber: number | string | null } | undefined>,
    db('clients').where({ id: inv.leadId, agencyId }).first('email') as Promise<{ email: string | null } | undefined>,
  ])
  const email = lead?.email && emailHashOf(lead.email) === inv.emailHash ? maskedEmail(lead.email) : null
  return {
    status: 'answered',
    stopReason: 'quote_invite_sent',
    headline: 'נשלחה הזמנה במייל. ההצעה עדיין לא נשלחה ללקוח',
    text: quoteInvitedReply({ quoteNumber: quote?.quoteNumber == null ? null : Number(quote.quoteNumber), email, validUntil: formatBusinessDate(inv.authorizationExpiresAt) }),
  }
}

type Card = { job: WaAssistantJob; scope: AgentScope; card: WaApproval; approve: boolean; nowMs: number }

async function consume({ job, card, approve, nowMs }: Card): Promise<MeetingReply | null> {
  const consumed = await decideWaApproval({ token: card.token, recipientId: job.recipientId, decision: approve ? 'approved' : 'rejected', now: new Date(nowMs) })
  if (consumed.ok === true) return null
  const text = consumed.reason === 'expired' ? DELIVERY_COPY.expired : consumed.reason === 'superseded' ? DELIVERY_COPY.superseded : consumed.reason === 'already_decided' ? DELIVERY_COPY.alreadyDecided : DELIVERY_COPY.notFound
  return reply('refused', `decision_${consumed.reason}`, text)
}

export type SendCardArgs = { quoteId: number; version: number; customerPhoneE164: string }

export async function decideQuoteSendCard(input: Card & { args: SendCardArgs }): Promise<MeetingReply> {
  const { scope, card, approve, nowMs, args } = input
  const refused = await consume(input)
  if (refused) return refused

  const decided = await decideOnAction({ actionId: card.actionId, argsHash: card.argsHash, decision: approve ? 'APPROVED' : 'REJECTED', scope, nowMs })
  if (decided.ok === false) return decided.reason === 'agent-disabled' ? reply('refused', 'decision_agent_disabled', COPY.notAvailable) : reply('refused', `decision_${decided.reason}`, DELIVERY_COPY.stale)
  if (!approve) {
    await recordQuoteEvent({ agencyId: scope.agencyId, quoteId: args.quoteId, quoteVersion: args.version, type: 'send_declined', actorUserId: scope.userId, actionId: card.actionId })
    return reply('answered', 'quote_send_declined', DELIVERY_COPY.declined)
  }

  const { outcome } = decided
  if (outcome.report === 'VERIFIED_SUCCESS' || outcome.report === 'DUPLICATE_NOOP') {
    const row = await findQuoteDeliveryByAction(scope.agencyId, card.actionId)
    if (!row) return invitedReply(scope.agencyId, card.actionId, outcome.report === 'DUPLICATE_NOOP')
    if (!['accepted', 'delivered', 'read'].includes(row.state)) return reply('failed', 'quote_send_unknown', DELIVERY_COPY.sendUnknown)
    if (outcome.report === 'DUPLICATE_NOOP') return reply('answered', 'quote_send_already', DELIVERY_COPY.alreadySent)
    const quote = (await db('sales_quotes').where({ id: row.quoteId, agencyId: scope.agencyId }).first('quoteNumber')) as { quoteNumber: number | string | null } | undefined
    return { status: 'answered', stopReason: 'quote_send_accepted', headline: 'הצעת המחיר נשלחה ללקוח', text: quoteSentReply({ quoteNumber: quote?.quoteNumber == null ? null : Number(quote.quoteNumber), phoneE164Masked: maskedPhone(args.customerPhoneE164) }) }
  }
  const reason = outcome.execution?.reason ?? ''
  // An invitation's outcome is about the email, never the quote: worded on its own, before the generic "unknown".
  const invite = INVITE_REASONS[reason]
  if (invite) return reply(invite[0], `quote_${reason.replace(/-/g, '_')}`, invite[1])
  if (outcome.report === 'EXECUTED_UNVERIFIED' || outcome.report === 'UNKNOWN_RECONCILE') return reply('failed', 'quote_send_unknown', DELIVERY_COPY.sendUnknown)
  if (outcome.execution?.status === 'NOT_AUTHORIZED') return reply('refused', 'quote_send_not_authorized', DELIVERY_COPY.noSendPermission)
  if (reason === 'quote-send-already-sent') return reply('refused', 'quote_send_already', DELIVERY_COPY.alreadySent)
  if (reason === 'quote-send-stale' || reason === 'quote-send-no-target') return reply('refused', 'quote_send_stale', DELIVERY_COPY.stale)
  if (reason === 'quote-send-opted-out') return reply('refused', 'quote_send_opted_out', DELIVERY_COPY.optedOut)
  if (reason === 'quote-send-no-channel') return reply('refused', 'quote_send_no_channel', DELIVERY_COPY.windowClosed)
  return reply('failed', 'quote_send_failed', DELIVERY_COPY.sendFailed)
}

export async function decideQuoteEditCard(input: Card & { args: { quoteId: number } }): Promise<MeetingReply> {
  const { job, scope, card, approve, nowMs, args } = input
  const refused = await consume(input)
  if (refused) return refused

  const decided = await decideOnAction({ actionId: card.actionId, argsHash: card.argsHash, decision: approve ? 'APPROVED' : 'REJECTED', scope, nowMs })
  if (decided.ok === false) return decided.reason === 'agent-disabled' ? reply('refused', 'decision_agent_disabled', COPY.notAvailable) : reply('refused', `decision_${decided.reason}`, DELIVERY_COPY.editStale)

  if (!approve) {
    // The edit's card replaced the send card (one live card per owner): offer it again, unchanged.
    const again = await prepareQuoteSendCard({ agencyId: scope.agencyId, quoteId: args.quoteId, scope, recipientId: job.recipientId, jobId: job.id, nowMs })
    if (again.kind !== 'card') return reply('answered', 'quote_edit_declined', `${DELIVERY_COPY.editDeclined}\n${again.text}`)
    return { status: 'answered', stopReason: 'quote_edit_declined', headline: null, text: `${DELIVERY_COPY.editDeclined}\n\n${again.body}`, buttons: again.buttons, document: again.document }
  }

  const { outcome } = decided
  if (outcome.report === 'VERIFIED_SUCCESS' || outcome.report === 'DUPLICATE_NOOP') {
    const row = (await db('sales_quotes').where({ id: args.quoteId, agencyId: scope.agencyId }).first('quoteNumber', 'version', 'totalAmount')) as
      | { quoteNumber: number | string | null; version: number; totalAmount: number | string }
      | undefined
    if (!row) return reply('failed', 'quote_edit_unverified', DELIVERY_COPY.editUnverified)
    const pdf = await startQuotePdf({ agencyId: scope.agencyId, quoteId: args.quoteId, renderedByUserId: scope.userId, nowMs })
    return {
      status: 'answered',
      stopReason: 'quote_edit_done',
      headline: 'הצעת המחיר עודכנה',
      text: quoteEditedReply({ quoteNumber: row.quoteNumber == null ? null : Number(row.quoteNumber), version: Number(row.version), totalAmount: Number(row.totalAmount), pdfPending: pdf === 'started' }),
    }
  }
  if (outcome.report === 'EXECUTED_UNVERIFIED' || outcome.report === 'UNKNOWN_RECONCILE') return reply('failed', 'quote_edit_unverified', DELIVERY_COPY.editUnverified)
  if (outcome.execution?.status === 'NOT_AUTHORIZED') return reply('refused', 'quote_edit_not_authorized', DELIVERY_COPY.notAllowed)
  if ((outcome.execution?.reason ?? '').startsWith('quote-edit-')) return reply('refused', 'quote_edit_stale', DELIVERY_COPY.editStale)
  return reply('failed', 'quote_edit_failed', DELIVERY_COPY.editFailed)
}

/**
 * "לבטל הצעה" on a preview card: the send approval is closed (never executed) and
 * the quote itself is withdrawn, under the lock a send takes (db/quotes/cancelQuote.ts).
 * Nothing reaches the customer; a quote already out with them is not cancelled.
 */
export async function decideQuoteCancelCard(input: Card & { args: SendCardArgs }): Promise<MeetingReply> {
  const { scope, card, nowMs, args } = input
  if (!canDraftQuote({ role: scope.role } as UserDb)) return reply('refused', 'quote_cancel_not_authorized', DELIVERY_COPY.notAllowed)
  const refused = await consume({ ...input, approve: false })
  if (refused) return refused

  const decided = await decideOnAction({ actionId: card.actionId, argsHash: card.argsHash, decision: 'REJECTED', scope, nowMs })
  if (decided.ok === false) return decided.reason === 'agent-disabled' ? reply('refused', 'decision_agent_disabled', COPY.notAvailable) : reply('refused', `decision_${decided.reason}`, DELIVERY_COPY.cancelStale)

  const r = await cancelQuoteSystem({
    agencyId: scope.agencyId,
    quoteId: args.quoteId,
    expectedVersion: args.version,
    actorUserId: scope.userId,
    actionId: card.actionId,
    visibility: { user: { role: scope.role as Roles }, gotPermIds: scope.gotPermIds ?? [] },
  }).catch(() => null)
  if (!r) return reply('failed', 'quote_cancel_failed', DELIVERY_COPY.cancelFailed)
  if (r.ok === true) return r.already ? reply('answered', 'quote_cancel_already', DELIVERY_COPY.alreadyCancelled) : { status: 'answered', stopReason: 'quote_cancelled', headline: 'הצעת המחיר בוטלה', text: DELIVERY_COPY.cancelled }
  const reason = (r as { reason: string }).reason
  if (reason === 'already_sent') return reply('refused', 'quote_cancel_already_sent', DELIVERY_COPY.cancelRefusedSent)
  if (reason === 'quote_not_found') return reply('refused', 'quote_cancel_not_allowed', DELIVERY_COPY.notAllowed)
  return reply('refused', `quote_cancel_${reason}`, DELIVERY_COPY.cancelStale)
}
