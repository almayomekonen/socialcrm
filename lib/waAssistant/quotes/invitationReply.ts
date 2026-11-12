import 'server-only'
import type { Knex } from 'knex'
import { db } from '@/config/db'
import { invalidateInvitation, linkInvitationDelivery, matchInboundInvitation, redeemInvitation, type InvitationRow } from '@/db/quotes/invitations'
import { isWaAssistantQuotesEmailInviteAgency } from '@/lib/flags/waAssistantFlags'
import { canSendQuote } from '@/lib/quotes/permissions'
import { roleMayAct } from '@/lib/agent/actions/policy'
import { hashInvitationRef, invitationRefIn } from '@/lib/quotes/invitationRef'
import { toCustomerPhoneE164 } from '@/lib/whatsapp/optOut/phone'
import { isAdmin, type Roles } from '@/types/roles'
import type { UserDb } from '@/db/auth'
import { sendQuoteToCustomer, type QuoteSendOutcome } from './customerSend'
import { invitedQuoteRefusedNotice, invitedQuoteSentNotice, type InviteRefusal } from './deliveryCopy'
import { approvingOwner, tellApprovingOwner } from './ownerNotice'

/**
 * The customer answered an email invitation on WhatsApp. Two steps, split around
 * the inbound transaction (lib/inbox/ingestWhatsappInbound.ts):
 *
 * 1. `matchInvitationReply`, INSIDE it: is this message the reference of a live
 *    invitation, from the exact agency, business number and customer number it
 *    was bound to? Everything here comes from Meta's webhook and our own rows,
 *    never from anything the customer claims. A match keeps the customer-facing
 *    autoresponder out of this one message.
 *
 * 2. `deliverInvitedQuote`, AFTER commit (the message has now opened the service
 *    window): redeem it once, re-check the approver and the quote, then run the
 *    one path that sends a quote, under the approved action's own id. That path
 *    re-compares the version, PDF, recipient and expiry under the quote lock, and
 *    its claim makes a second send impossible. Never throws.
 *
 * No model runs and no usage credit is spent here.
 */

export async function matchInvitationReply(
  executor: Knex | Knex.Transaction,
  input: { agencyId: number; businessPhoneNumberId: string; customerWaId: string; text: string | null },
): Promise<number | null> {
  const ref = invitationRefIn(input.text)
  if (!ref || !isWaAssistantQuotesEmailInviteAgency(input.agencyId)) return null
  const customerPhoneE164 = toCustomerPhoneE164(input.customerWaId)
  if (!customerPhoneE164) return null
  const inv = await matchInboundInvitation(executor, { agencyId: input.agencyId, businessPhoneNumberId: input.businessPhoneNumberId, customerPhoneE164, refHash: hashInvitationRef(ref) })
  return inv?.id ?? null
}

export type InvitedDelivery = 'sent' | 'refused' | 'not_live'

const quoteNumberOf = async (inv: InvitationRow) => {
  const q = (await db('sales_quotes').where({ id: inv.quoteId, agencyId: inv.agencyId }).first('quoteNumber', 'totalAmount')) as { quoteNumber: number | string | null; totalAmount: number | string } | undefined
  return { quoteNumber: q?.quoteNumber == null ? null : Number(q.quoteNumber), totalAmount: q ? Number(q.totalAmount) : null }
}

/** What the send path answered, as the owner should hear it. */
function refusalOf(r: QuoteSendOutcome, inv: InvitationRow): InviteRefusal | null {
  switch (r.kind) {
    case 'accepted':
      return null
    case 'duplicate':
      if (r.delivery.actionId !== inv.actionId) return 'already'
      return r.delivery.state === 'failed' ? 'failed' : r.delivery.state === 'unknown' || r.delivery.state === 'sending' ? 'unknown' : null
    case 'unknown':
      return 'unknown'
    case 'stale':
    case 'no_target':
      return 'changed'
    case 'delivery_live':
      return 'already'
    case 'disabled':
      return 'not_authorized'
    // The window this message opened is on a conversation that is no longer this lead's.
    case 'no_channel':
      return 'not_linked'
    default:
      return 'failed'
  }
}

export async function deliverInvitedQuote(input: { agencyId: number; invitationId: number; nowMs: number }): Promise<InvitedDelivery> {
  try {
    const inv = await redeemInvitation(input.invitationId, input.agencyId)
    if (!inv) return 'not_live'
    const { quoteNumber, totalAmount } = await quoteNumberOf(inv)
    const owner = await approvingOwner(inv.agencyId, inv.actionId)
    const refuse = async (why: InviteRefusal, code: string): Promise<InvitedDelivery> => {
      await invalidateInvitation(inv, code)
      await tellApprovingOwner({ agencyId: inv.agencyId, actionId: inv.actionId, owner, body: invitedQuoteRefusedNotice(quoteNumber, why), jobId: inv.quoteId }).catch(() => undefined)
      return 'refused'
    }

    if (inv.authorizationExpiresAt.getTime() <= input.nowMs) return refuse('expired', 'authorization_expired')
    // The approval is only as good as the person who gave it, as they are NOW.
    if (!owner || owner.scope.userId !== inv.approvedByUserId) return refuse('not_authorized', 'approver_inactive')
    // Exactly what approving a send needs today: a role that may send, and the Action Runtime's ceiling for it.
    if (!canSendQuote({ role: owner.scope.role } as UserDb) || !roleMayAct('APPROVAL_REQUIRED', owner.scope.role)) return refuse('not_authorized', 'approver_role')
    const visible = db('clients').where({ id: inv.leadId, agencyId: inv.agencyId })
    if (!isAdmin(owner.scope.role as Roles)) visible.whereIn('userId', owner.scope.gotPermIds ?? [])
    if (!(await visible.first('id'))) return refuse('not_authorized', 'lead_not_visible')
    if (totalAmount == null || totalAmount !== inv.totalAmount) return refuse('changed', 'amount_changed')

    const r = await sendQuoteToCustomer({
      agencyId: inv.agencyId,
      userId: owner.scope.userId,
      actionId: inv.actionId,
      args: { quoteId: inv.quoteId, version: inv.quoteVersion, documentId: inv.documentId, contentHash: inv.contentHash, leadId: inv.leadId, customerPhoneE164: inv.customerPhoneE164, businessPhoneNumberId: inv.businessPhoneNumberId },
      nowMs: input.nowMs,
      invite: false,
    })
    const deliveryId = r.kind === 'accepted' ? r.deliveryId : r.kind === 'duplicate' && r.delivery.actionId === inv.actionId ? r.delivery.id : null
    if (deliveryId != null) await linkInvitationDelivery(inv, deliveryId)
    const why = refusalOf(r, inv)
    if (why === null) {
      await tellApprovingOwner({ agencyId: inv.agencyId, actionId: inv.actionId, owner, body: invitedQuoteSentNotice(quoteNumber), jobId: inv.quoteId }).catch(() => undefined)
      return 'sent'
    }
    // A send that was attempted keeps its own record (failed / unknown); only a refusal before it invalidates.
    if (deliveryId != null) {
      await tellApprovingOwner({ agencyId: inv.agencyId, actionId: inv.actionId, owner, body: invitedQuoteRefusedNotice(quoteNumber, why), jobId: inv.quoteId }).catch(() => undefined)
      return 'refused'
    }
    return refuse(why, `send_${r.kind}`)
  } catch (err) {
    console.error('[quotes.invite] reply.fail', (err as Error)?.name)
    return 'refused'
  }
}
