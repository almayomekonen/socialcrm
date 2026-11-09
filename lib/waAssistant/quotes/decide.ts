import 'server-only'
import { db } from '@/config/db'
import { decideOnAction } from '@/lib/agent/actions/bridge'
import { decideWaApproval, type WaApproval } from '@/db/waAssistantApprovals'
import { COPY } from '../render'
import type { AgentScope } from '@/lib/agent/types'
import type { ActionOutcome } from '@/lib/agent/actions'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { MeetingReply } from '../meetings/types'
import { QUOTE_COPY, quoteSuccessReply } from './copy'
import { findQuoteByAutomationKeyQuery } from '@/db/quotes/quotes'
import { quoteAutomationKey } from '@/lib/agent/actions/domain/createQuote'
import { startQuotePdf } from './pdfJob'

/**
 * A tap on a quote card. Same path as leadUpdates/decide.ts: the token is
 * consumed in one guarded statement (pending, unexpired, this recipient), then
 * the EXISTING `decideOnAction` (rollout re-check, proposer, argsHash, claim and
 * lock), then the executor: role + lead visibility against the CURRENT rows and
 * the approved total and rate, then verification against the persisted quote.
 * Nothing here writes a quote, and nothing here sends anything to the customer.
 */

export type QuoteDecideDeps = { decide?: typeof decideOnAction; startPdf?: typeof startQuotePdf }

const reply = (status: MeetingReply['status'], stopReason: string, text: string | null): MeetingReply => ({ status, stopReason, text, headline: null })

const STALE_REASONS = new Set(['quote-rate_changed', 'quote-total_mismatch', 'quote-tax_rate_missing'])

export async function decideQuoteCard(input: {
  job: WaAssistantJob
  scope: AgentScope
  card: WaApproval
  args: { clientId: number }
  approve: boolean
  nowMs: number
  deps?: QuoteDecideDeps
}): Promise<MeetingReply> {
  const { job, scope, card, approve, nowMs } = input

  const consumed = await decideWaApproval({ token: card.token, recipientId: job.recipientId, decision: approve ? 'approved' : 'rejected', now: new Date(nowMs) })
  if (consumed.ok === false) {
    const text =
      consumed.reason === 'expired'
        ? QUOTE_COPY.expired
        : consumed.reason === 'superseded'
          ? QUOTE_COPY.superseded
          : consumed.reason === 'already_decided'
            ? QUOTE_COPY.alreadyDecided
            : QUOTE_COPY.notFound
    return reply('refused', `decision_${consumed.reason}`, text)
  }

  const decided = await (input.deps?.decide ?? decideOnAction)({ actionId: card.actionId, argsHash: card.argsHash, decision: approve ? 'APPROVED' : 'REJECTED', scope, nowMs })
  if (decided.ok === false) {
    return decided.reason === 'agent-disabled'
      ? reply('refused', 'decision_agent_disabled', COPY.notAvailable)
      : reply('refused', `decision_${decided.reason}`, QUOTE_COPY.changed)
  }
  if (!approve) return reply('answered', 'quote_rejected', QUOTE_COPY.rejected)
  return reportOutcome(decided.outcome, input.args, scope, input.deps)
}

async function reportOutcome(outcome: ActionOutcome, args: { clientId: number }, scope: AgentScope, deps?: QuoteDecideDeps): Promise<MeetingReply> {
  if (outcome.report === 'VERIFIED_SUCCESS' || outcome.report === 'DUPLICATE_NOOP') {
    const reported = outcome.verification?.targetIds?.find((t) => t.kind === 'quote')?.id ?? outcome.execution?.targetIds?.find((t) => t.kind === 'quote')?.id
    // A duplicate may carry no target: the action's own automationKey finds its quote.
    const byKey = reported ? null : ((await findQuoteByAutomationKeyQuery(scope.agencyId, quoteAutomationKey(outcome.actionId), db)) as { id: number } | undefined)
    const quoteId = Number(reported ?? byKey?.id)
    const row = Number.isSafeInteger(quoteId)
      ? ((await db('sales_quotes as q')
          .join('clients as c', function () {
            this.on('c.id', '=', 'q.leadId').andOn('c.agencyId', '=', 'q.agencyId')
          })
          .where({ 'q.id': quoteId, 'q.agencyId': scope.agencyId, 'q.leadId': args.clientId })
          .first('q.quoteNumber', 'q.totalAmount', 'q.status', 'c.firstName', 'c.lastName')) as
          | { quoteNumber: number | null; totalAmount: string; status: string; firstName: string | null; lastName: string | null }
          | undefined)
      : undefined
    if (!row || row.status !== 'ready') return reply('failed', 'quote_unverified', QUOTE_COPY.unverified)
    const already = outcome.report === 'DUPLICATE_NOOP' || (outcome.execution?.detail as { created?: boolean } | undefined)?.created === false
    // Idempotent and never throws: the PDF runs after this reply, and a failure there cannot touch the quote.
    const pdf = await (deps?.startPdf ?? startQuotePdf)({ agencyId: scope.agencyId, quoteId, renderedByUserId: scope.userId })
    return {
      status: 'answered',
      stopReason: already ? 'quote_already_done' : 'quote_done',
      // Number and total are the ones just re-read from the quote, never the request's.
      text: quoteSuccessReply({
        lead: [row.firstName, row.lastName].filter(Boolean).join(' '),
        quoteNumber: row.quoteNumber == null ? null : Number(row.quoteNumber),
        totalAmount: Number(row.totalAmount),
        already,
        pdfPending: pdf === 'started',
      }),
      headline: 'הצעת המחיר נוצרה ב-SocialCRM',
    }
  }
  if (outcome.report === 'EXECUTED_UNVERIFIED' || outcome.report === 'UNKNOWN_RECONCILE')
    return reply('failed', `quote_${outcome.report.toLowerCase()}`, QUOTE_COPY.unverified)
  if (outcome.execution?.status === 'NOT_AUTHORIZED') return reply('refused', 'quote_not_authorized', QUOTE_COPY.notAuthorized)
  if (STALE_REASONS.has(outcome.execution?.reason ?? '')) return reply('refused', 'quote_stale_totals', QUOTE_COPY.staleTotals)
  return reply('failed', `quote_${outcome.report.toLowerCase()}`, QUOTE_COPY.failed)
}
