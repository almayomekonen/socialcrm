import 'server-only'
import { decideOnAction } from '@/lib/agent/actions/bridge'
import { decideWaApproval, type WaApproval } from '@/db/waAssistantApprovals'
import { findSmartbeeDocumentByAction } from '@/db/smartbee/documents'
import { resolveIntegrationAccess } from '@/lib/integrations/core/permissions'
import { COPY } from '../render'
import type { AgentScope } from '@/lib/agent/types'
import type { ActionOutcome } from '@/lib/agent/actions'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { MeetingReply } from '../meetings/types'
import { DOCUMENT_COPY, documentRetryingReply, documentSubmittedReply } from './copy'
import { startSmartbeeFollow } from './follow'

/**
 * A tap on a SmartBee document card. Same path as ../quotes/decide.ts: the
 * token is consumed in one guarded statement (pending, unexpired, this
 * recipient), then the EXISTING `decideOnAction` (rollout re-check, proposer,
 * argsHash, claim and lock), then the executor, which checks owner, connection,
 * environment and lead visibility AGAIN and records the request.
 *
 * Before any of that, the owner check runs here too: a card created while this
 * user was the connection's owner is refused if the owner has since changed.
 *
 * The reply never says the document was issued: SmartBee confirms that later,
 * and ./follow.ts sends the number and link only after it does.
 */

export type DocumentDecideDeps = { decide?: typeof decideOnAction; access?: typeof resolveIntegrationAccess; follow?: typeof startSmartbeeFollow }

const reply = (status: MeetingReply['status'], stopReason: string, text: string | null): MeetingReply => ({ status, stopReason, text, headline: null })

export async function decideSmartbeeDocumentCard(input: {
  job: WaAssistantJob
  scope: AgentScope
  card: WaApproval
  approve: boolean
  nowMs: number
  deps?: DocumentDecideDeps
}): Promise<MeetingReply> {
  const { job, scope, card, approve, nowMs } = input

  if (approve) {
    const access = await (input.deps?.access ?? resolveIntegrationAccess)({ provider: 'smartbee', agencyId: scope.agencyId, userId: scope.userId })
    if (access.ok === false) {
      await decideWaApproval({ token: card.token, recipientId: job.recipientId, decision: 'rejected', now: new Date(nowMs) })
      return reply('refused', `document_${access.reason}`, access.reason === 'not_owner' ? DOCUMENT_COPY.notOwner : DOCUMENT_COPY.notConnected)
    }
  }

  const consumed = await decideWaApproval({ token: card.token, recipientId: job.recipientId, decision: approve ? 'approved' : 'rejected', now: new Date(nowMs) })
  if (consumed.ok === false) {
    const text =
      consumed.reason === 'expired'
        ? DOCUMENT_COPY.expired
        : consumed.reason === 'superseded'
          ? DOCUMENT_COPY.superseded
          : consumed.reason === 'already_decided'
            ? DOCUMENT_COPY.alreadyDecided
            : DOCUMENT_COPY.notFound
    return reply('refused', `decision_${consumed.reason}`, text)
  }

  const decided = await (input.deps?.decide ?? decideOnAction)({ actionId: card.actionId, argsHash: card.argsHash, decision: approve ? 'APPROVED' : 'REJECTED', scope, nowMs })
  if (decided.ok === false) {
    return decided.reason === 'agent-disabled' ? reply('refused', 'decision_agent_disabled', COPY.notAvailable) : reply('refused', `decision_${decided.reason}`, DOCUMENT_COPY.changed)
  }
  if (!approve) return reply('answered', 'document_rejected', DOCUMENT_COPY.rejected)
  return reportOutcome(decided.outcome, scope, input.deps)
}

async function reportOutcome(outcome: ActionOutcome, scope: AgentScope, deps?: DocumentDecideDeps): Promise<MeetingReply> {
  if (outcome.report === 'VERIFIED_SUCCESS' || outcome.report === 'DUPLICATE_NOOP') {
    const row = await findSmartbeeDocumentByAction(scope.agencyId, outcome.actionId)
    if (!row) return reply('failed', 'document_unverified', DOCUMENT_COPY.failed)
    // Never throws, never waits: SmartBee is called after this reply has gone.
    ;(deps?.follow ?? startSmartbeeFollow)({ agencyId: scope.agencyId, documentId: row.id })
    const text = row.status === 'pending' && row.submitAttempts > 0 ? documentRetryingReply(row.docType) : documentSubmittedReply(row.docType)
    return { status: 'answered', stopReason: outcome.report === 'DUPLICATE_NOOP' ? 'document_already_recorded' : 'document_recorded', text, headline: 'בקשת מסמך נמסרה ל-SmartBee וממתינה לאישור' }
  }
  if (outcome.execution?.status === 'NOT_AUTHORIZED') return reply('refused', 'document_not_authorized', DOCUMENT_COPY.notOwner)
  if (outcome.execution?.reason === 'smartbee-connection-changed') return reply('refused', 'document_connection_changed', DOCUMENT_COPY.changed)
  if (outcome.execution?.reason === 'smartbee-request-in-flight') return reply('refused', 'document_in_flight', DOCUMENT_COPY.inFlight)
  if (outcome.execution?.status === 'INVALID_ACTION') return reply('refused', 'document_invalid', DOCUMENT_COPY.invalid)
  return reply('failed', `document_${outcome.report.toLowerCase()}`, DOCUMENT_COPY.failed)
}
