import 'server-only'
import { db } from '@/config/db'
import { submitProposedAction } from '@/lib/agent/actions/bridge'
import { createWaApproval } from '@/db/waAssistantApprovals'
import { hasActiveDefinitionsForTrigger } from '@/db/automations/definitions'
import { isLeadStatus } from '@/lib/system/updateLeadStatusSystem'
import type { AgentScope, EvidenceRef, ProposedAction } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { MeetingReply } from '../meetings/types'
import { requestMessages } from '../request'
import { chooseLead } from '../leadChoice'
import { LEAD_UPDATE_COPY, alreadyInStatus, leadUpdateButtons, noteCard, statusCard } from './copy'

/**
 * "תעביר את אבי לסגור" / "תרשום שדנה רוצה לדבר שבוע הבא" → a confirmation card,
 * or ONE short question about the one detail that is genuinely missing.
 *
 * NOTHING IS CHANGED HERE. Same order as tasks/propose.ts:
 *   1. the lead (leadChoice.ts): readable by THIS user; several matches → the
 *      owner chooses, never us;
 *   2. status: the target must be one of the five codes; the CURRENT status is
 *      read from the lead row (never the model) and bound into the action as
 *      `fromStatus`, so the card shows, and the hash binds, "from X to Y";
 *   3. the existing Action Runtime records the action AWAITING_APPROVAL
 *      (submitted without the owner's words, and `update_lead_status` forces
 *      approval anyway);
 *   4. a single-use, recipient-bound, 15-minute token binds the buttons.
 */

export type LeadUpdateProposal = Extract<ProposedAction, { actionType: 'update_lead_status' | 'add_lead_note' }>
export type LeadUpdateProposeDeps = { submit?: typeof submitProposedAction; hasStatusAutomations?: (agencyId: number) => Promise<boolean> }

const clarify = (kind: 'status' | 'note', text: string, why: string, lead?: string): MeetingReply => ({
  status: 'answered',
  stopReason: `${kind}_clarify_${why}`,
  text,
  headline: lead ? `${text} (${kind === 'status' ? 'סטטוס' : 'הערה'} · ליד: ${lead})` : text,
})

export async function proposeLeadUpdate(input: {
  job: WaAssistantJob
  scope: AgentScope
  proposal: LeadUpdateProposal
  evidence: readonly EvidenceRef[]
  agentRunId: string
  question: string
  nowMs: number
  deps?: LeadUpdateProposeDeps
}): Promise<MeetingReply> {
  const { job, scope, nowMs, proposal: p } = input
  const kind = p.actionType === 'update_lead_status' ? 'status' : 'note'
  const said = await requestMessages(kind, job, input.question)

  const clientId = Number(p.args.clientId)
  if (!Number.isSafeInteger(clientId) || clientId <= 0) return clarify(kind, LEAD_UPDATE_COPY.askLead, 'lead')
  const choice = await chooseLead({ scope, proposedId: clientId, evidence: input.evidence, said })
  if ('refused' in choice) return { status: 'refused', stopReason: `${kind}_lead_not_allowed`, text: LEAD_UPDATE_COPY.leadNotAllowed, headline: null }
  if ('ask' in choice) return clarify(kind, choice.ask, 'lead')
  const lead = choice.lead
  const evidenceRefs = p.evidenceRefs.includes(`lead:${lead.id}`) ? p.evidenceRefs : [...p.evidenceRefs, `lead:${lead.id}`]

  let final: ProposedAction
  let text: string
  if (p.actionType === 'update_lead_status') {
    if (!isLeadStatus(p.args.status)) return clarify('status', LEAD_UPDATE_COPY.askStatus, 'status', lead.name)
    const row = (await db('clients').where({ id: lead.id, agencyId: scope.agencyId }).first('status')) as { status: string | null } | undefined
    const from = row?.status ?? null
    if (from === p.args.status)
      return { status: 'answered', stopReason: 'status_already', text: alreadyInStatus(lead.name, p.args.status), headline: null }
    const automations = await (input.deps?.hasStatusAutomations ?? ((a: number) => hasActiveDefinitionsForTrigger(a, 'status_changed')))(scope.agencyId)
    final = { actionType: 'update_lead_status', args: { clientId: lead.id, status: p.args.status, fromStatus: from }, evidenceRefs }
    text = statusCard({ lead: lead.name, from, to: p.args.status, automations })
  } else {
    const content = p.args.content?.trim() ?? ''
    if (!content) return clarify('note', LEAD_UPDATE_COPY.askNote, 'content', lead.name)
    final = { actionType: 'add_lead_note', args: { clientId: lead.id, content }, evidenceRefs }
    text = noteCard({ lead: lead.name, content })
  }

  const outcome = await (input.deps?.submit ?? submitProposedAction)({ proposal: final, scope, agentRunId: input.agentRunId })
  if (!outcome || outcome.report !== 'AWAITING_APPROVAL') {
    return { status: 'failed', stopReason: `${kind}_propose_${outcome?.report ?? 'unparsed'}`, text: LEAD_UPDATE_COPY.notPrepared, headline: null }
  }
  const { token } = await createWaApproval({
    recipientId: job.recipientId,
    agencyId: scope.agencyId,
    userId: scope.userId,
    jobId: job.id,
    actionId: outcome.actionId,
    argsHash: outcome.argsHash,
    now: new Date(nowMs),
  })
  return {
    status: 'answered',
    stopReason: `${kind}_awaiting_approval`,
    text,
    buttons: leadUpdateButtons(token, kind),
    headline: kind === 'status' ? 'ממתין לאישור עדכון סטטוס' : 'ממתין לאישור הוספת הערה',
  }
}
