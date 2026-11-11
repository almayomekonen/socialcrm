import 'server-only'
import { db } from '@/config/db'
import { decideOnAction } from '@/lib/agent/actions/bridge'
import { decideWaApproval, type WaApproval } from '@/db/waAssistantApprovals'
import { findQuoteDeliveryByAction } from '@/db/quotes/deliveries'
import { recordQuoteEvent } from '@/db/quotes/events'
import { COPY } from '../render'
import type { AgentScope } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { MeetingReply } from '../meetings/types'
import { DELIVERY_COPY, maskedPhone, quoteEditedReply, quoteSentReply } from './deliveryCopy'
import { startQuotePdf } from './pdfJob'
import { prepareQuoteSendCard } from './preview'

/**
 * A tap on a "send" or "apply this edit" card. Same path as every other card:
 * the token is consumed in one guarded statement (pending, unexpired, this
 * recipient), then the existing `decideOnAction` re-checks rollout, proposer and
 * argsHash, then the executor checks the world. No model runs here.
 */

const reply = (status: MeetingReply['status'], stopReason: string, text: string | null): MeetingReply => ({ status, stopReason, text, headline: null })

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
    if (!row || !['accepted', 'delivered', 'read'].includes(row.state)) return reply('failed', 'quote_send_unknown', DELIVERY_COPY.sendUnknown)
    if (outcome.report === 'DUPLICATE_NOOP') return reply('answered', 'quote_send_already', DELIVERY_COPY.alreadySent)
    const quote = (await db('sales_quotes').where({ id: row.quoteId, agencyId: scope.agencyId }).first('quoteNumber')) as { quoteNumber: number | string | null } | undefined
    return { status: 'answered', stopReason: 'quote_send_accepted', headline: 'הצעת המחיר נשלחה ללקוח', text: quoteSentReply({ quoteNumber: quote?.quoteNumber == null ? null : Number(quote.quoteNumber), phoneE164Masked: maskedPhone(args.customerPhoneE164) }) }
  }
  if (outcome.report === 'EXECUTED_UNVERIFIED' || outcome.report === 'UNKNOWN_RECONCILE') return reply('failed', 'quote_send_unknown', DELIVERY_COPY.sendUnknown)
  const reason = outcome.execution?.reason ?? ''
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
