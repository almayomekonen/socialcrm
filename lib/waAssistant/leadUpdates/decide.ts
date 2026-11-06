import 'server-only'
import { db } from '@/config/db'
import { decideOnAction } from '@/lib/agent/actions/bridge'
import { decideWaApproval, type WaApproval } from '@/db/waAssistantApprovals'
import { COPY } from '../render'
import type { AgentScope } from '@/lib/agent/types'
import type { ActionOutcome } from '@/lib/agent/actions'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { MeetingReply } from '../meetings/types'
import { LEAD_UPDATE_COPY, noteSuccessReply, statusSuccessReply } from './copy'

/**
 * A tap on a status or note card. Same path as tasks/decide.ts: the token is
 * consumed in one guarded statement (pending, unexpired, this recipient), then
 * the EXISTING `decideOnAction` — rollout re-check, proposer, argsHash, claim
 * and lock, the executor's own agency + rep check against the CURRENT row, and
 * verification against the persisted row. Nothing here writes to the lead.
 */

export type LeadUpdateDecideDeps = { decide?: typeof decideOnAction }

const reply = (status: MeetingReply['status'], stopReason: string, text: string | null): MeetingReply => ({ status, stopReason, text, headline: null })

export async function decideLeadUpdateCard(input: {
  job: WaAssistantJob
  scope: AgentScope
  card: WaApproval
  actionType: 'update_lead_status' | 'add_lead_note'
  args: { clientId: number; status?: string }
  approve: boolean
  nowMs: number
  deps?: LeadUpdateDecideDeps
}): Promise<MeetingReply> {
  const { job, scope, card, approve, nowMs } = input
  const kind = input.actionType === 'update_lead_status' ? 'status' : 'note'

  const consumed = await decideWaApproval({ token: card.token, recipientId: job.recipientId, decision: approve ? 'approved' : 'rejected', now: new Date(nowMs) })
  if (consumed.ok === false) {
    const text =
      consumed.reason === 'expired'
        ? LEAD_UPDATE_COPY.expired
        : consumed.reason === 'superseded'
          ? LEAD_UPDATE_COPY.superseded
          : consumed.reason === 'already_decided'
            ? LEAD_UPDATE_COPY.alreadyDecided
            : LEAD_UPDATE_COPY.notFound
    return reply('refused', `decision_${consumed.reason}`, text)
  }

  const decided = await (input.deps?.decide ?? decideOnAction)({ actionId: card.actionId, argsHash: card.argsHash, decision: approve ? 'APPROVED' : 'REJECTED', scope, nowMs })
  if (decided.ok === false) {
    return decided.reason === 'agent-disabled'
      ? reply('refused', 'decision_agent_disabled', COPY.notAvailable)
      : reply('refused', `decision_${decided.reason}`, LEAD_UPDATE_COPY.changed)
  }
  if (!approve) return reply('answered', `${kind}_rejected`, LEAD_UPDATE_COPY.rejected)
  return reportOutcome(decided.outcome, kind, input.args, scope)
}

async function reportOutcome(outcome: ActionOutcome, kind: 'status' | 'note', args: { clientId: number; status?: string }, scope: AgentScope): Promise<MeetingReply> {
  if (outcome.report === 'VERIFIED_SUCCESS' || outcome.report === 'DUPLICATE_NOOP') {
    const lead = (await db('clients').where({ id: args.clientId, agencyId: scope.agencyId }).first('firstName', 'lastName', 'status')) as
      | { firstName: string | null; lastName: string | null; status: string | null }
      | undefined
    if (!lead) return reply('failed', `${kind}_unverified`, LEAD_UPDATE_COPY.unverified)
    const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ')
    const already = outcome.report === 'DUPLICATE_NOOP' || (outcome.execution?.detail as { alreadyInStatus?: boolean } | undefined)?.alreadyInStatus === true
    return {
      status: 'answered',
      stopReason: already ? `${kind}_already_done` : `${kind}_done`,
      // The status shown is the one just re-read from the lead, never the request's.
      text: kind === 'status' ? statusSuccessReply({ lead: leadName, status: lead.status ?? args.status ?? '', already }) : noteSuccessReply({ lead: leadName, already }),
      headline: kind === 'status' ? 'הסטטוס עודכן ב-SocialCRM' : 'ההערה נשמרה ב-SocialCRM',
    }
  }
  if (outcome.report === 'EXECUTED_UNVERIFIED' || outcome.report === 'UNKNOWN_RECONCILE')
    return reply('failed', `${kind}_${outcome.report.toLowerCase()}`, LEAD_UPDATE_COPY.unverified)
  if (outcome.execution?.status === 'NOT_AUTHORIZED') return reply('refused', `${kind}_not_authorized`, LEAD_UPDATE_COPY.notAuthorized)
  if (outcome.execution?.reason === 'status-changed-since-proposal') return reply('refused', 'status_stale', LEAD_UPDATE_COPY.staleStatus)
  return reply('failed', `${kind}_${outcome.report.toLowerCase()}`, LEAD_UPDATE_COPY.failed)
}
