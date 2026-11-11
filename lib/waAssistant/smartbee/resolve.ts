import 'server-only'
import { submitProposedAction, decideOnAction } from '@/lib/agent/actions/bridge'
import { createWaApproval, decideWaApproval, type WaApproval } from '@/db/waAssistantApprovals'
import { latestUnresolvedStalledDocument } from '@/db/smartbee/resolutions'
import { findSmartbeeDocument } from '@/db/smartbee/documents'
import { resolveIntegrationAccess } from '@/lib/integrations/core/permissions'
import type { AgentScope } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { COPY } from '../render'
import type { MeetingReply } from '../meetings/types'
import { DOCUMENT_COPY, RESOLVE_COPY, documentButtons, resolutionCard } from './copy'

/**
 * Settling a document SmartBee never confirmed (`stalled`), by its owner.
 *
 * NO MODEL. The owner's own fixed words, matched here BEFORE the Agent runs
 * ("המסמך קיים" / "המסמך לא קיים", optionally "מספר 1045"), open a card for the
 * newest unresolved stalled document of the agency. The card shows that
 * document from the stored row. Only the connection owner's TAP records
 * anything, through the `resolve_smartbee_document` action (owner re-checked
 * there). The model's answer schema cannot name this action, so no
 * AI-generated message can resolve a document, and neither can the words
 * alone: they only open the card.
 *
 * Returns null when the message is not one of these phrases, or there is no
 * stalled document: the turn continues as before.
 */

const HE = '\\u0590-\\u05FF'
const ABSENT = new RegExp(`(?<![${HE}])(?:ה)?מסמך\\s+(?:לא|אינו)\\s+(?:קיים|הופק|נמצא)(?![${HE}])`, 'u')
const EXISTS = new RegExp(`(?<![${HE}])(?:ה)?מסמך\\s+(?:כן\\s+)?(?:קיים|הופק|נמצא)(?![${HE}])`, 'u')
const NUMBER = /(?:מספר|מס['׳]?)\s*(\d{1,12})(?!\d)/u
const MAX_CHARS = 120

export type ResolutionPhrase = { resolution: 'exists' | 'absent'; docIndex: string | null }

/** Pure: the owner's fixed phrase, or null. "לא קיים" is checked first, so it never reads as "קיים". */
export function resolutionPhrase(text: string): ResolutionPhrase | null {
  const t = text.trim()
  if (!t || t.length > MAX_CHARS) return null
  if (ABSENT.test(t)) return { resolution: 'absent', docIndex: null }
  if (EXISTS.test(t)) return { resolution: 'exists', docIndex: NUMBER.exec(t)?.[1] ?? null }
  return null
}

export type ResolveDeps = { submit?: typeof submitProposedAction; decide?: typeof decideOnAction }

const reply = (status: MeetingReply['status'], stopReason: string, text: string | null): MeetingReply => ({ status, stopReason, text, headline: null })

export async function handleSmartbeeResolutionMessage(input: { job: WaAssistantJob; scope: AgentScope; nowMs: number; deps?: ResolveDeps }): Promise<MeetingReply | null> {
  const { job, scope, nowMs } = input
  const phrase = resolutionPhrase(job.question ?? '')
  if (!phrase) return null
  const doc = await latestUnresolvedStalledDocument(scope.agencyId)
  if (!doc) return null

  const access = await resolveIntegrationAccess({ provider: 'smartbee', agencyId: scope.agencyId, userId: scope.userId })
  if (access.ok === false) return reply('refused', `resolve_${access.reason}`, RESOLVE_COPY.notOwner)

  const outcome = await (input.deps?.submit ?? submitProposedAction)({
    proposal: { actionType: 'resolve_smartbee_document', args: { smartbeeDocumentId: doc.id, resolution: phrase.resolution, docIndex: phrase.docIndex }, evidenceRefs: [] },
    scope,
    agentRunId: `wa_resolve_${job.id}`,
  })
  if (!outcome || outcome.report !== 'AWAITING_APPROVAL') return reply('failed', `resolve_propose_${outcome?.report ?? 'unparsed'}`, RESOLVE_COPY.failed)
  const { token } = await createWaApproval({ recipientId: job.recipientId, agencyId: scope.agencyId, userId: scope.userId, jobId: job.id, actionId: outcome.actionId, argsHash: outcome.argsHash, now: new Date(nowMs) })
  const customer = doc.requestSnapshot?.customer?.name ?? ''
  return {
    status: 'answered',
    stopReason: 'resolve_awaiting_approval',
    text: resolutionCard({ docType: doc.docType, customer, amount: doc.totalAmount, requestedAt: new Date(doc.createdAt), resolution: phrase.resolution, docIndex: phrase.docIndex }),
    buttons: documentButtons(token),
    headline: 'ממתין לאישור סימון מסמך SmartBee',
  }
}

/** A tap on a resolution card. Same path as every card: single-use token, proposer, argsHash, then the executor. */
export async function decideSmartbeeResolutionCard(input: {
  job: WaAssistantJob
  scope: AgentScope
  card: WaApproval
  args: { smartbeeDocumentId: number; resolution: 'exists' | 'absent' }
  approve: boolean
  nowMs: number
  deps?: ResolveDeps
}): Promise<MeetingReply> {
  const { job, scope, card, approve, nowMs } = input
  if (approve) {
    const access = await resolveIntegrationAccess({ provider: 'smartbee', agencyId: scope.agencyId, userId: scope.userId })
    if (access.ok === false) {
      await decideWaApproval({ token: card.token, recipientId: job.recipientId, decision: 'rejected', now: new Date(nowMs) })
      return reply('refused', `resolve_${access.reason}`, RESOLVE_COPY.notOwner)
    }
  }
  const consumed = await decideWaApproval({ token: card.token, recipientId: job.recipientId, decision: approve ? 'approved' : 'rejected', now: new Date(nowMs) })
  if (consumed.ok === false) {
    const text = consumed.reason === 'expired' ? DOCUMENT_COPY.expired : consumed.reason === 'already_decided' ? DOCUMENT_COPY.alreadyDecided : consumed.reason === 'superseded' ? DOCUMENT_COPY.superseded : DOCUMENT_COPY.notFound
    return reply('refused', `decision_${consumed.reason}`, text)
  }
  const decided = await (input.deps?.decide ?? decideOnAction)({ actionId: card.actionId, argsHash: card.argsHash, decision: approve ? 'APPROVED' : 'REJECTED', scope, nowMs })
  if (decided.ok === false) return decided.reason === 'agent-disabled' ? reply('refused', 'decision_agent_disabled', COPY.notAvailable) : reply('refused', `decision_${decided.reason}`, DOCUMENT_COPY.changed)
  if (!approve) return reply('answered', 'resolve_rejected', RESOLVE_COPY.rejected)

  const o = decided.outcome
  if (o.report === 'VERIFIED_SUCCESS' || o.report === 'DUPLICATE_NOOP') {
    // Built from the re-read row, never from the request.
    const row = await findSmartbeeDocument(scope.agencyId, input.args.smartbeeDocumentId)
    if (row?.resolution === 'exists') return reply('answered', 'resolve_exists', RESOLVE_COPY.existsDone)
    if (row?.resolution === 'absent') return reply('answered', 'resolve_absent', RESOLVE_COPY.absentDone)
    return reply('failed', 'resolve_unverified', RESOLVE_COPY.failed)
  }
  if (o.execution?.status === 'NOT_AUTHORIZED') return reply('refused', 'resolve_not_authorized', RESOLVE_COPY.notOwner)
  if (o.execution?.reason === 'smartbee-document-not-resolvable') return reply('refused', 'resolve_already', RESOLVE_COPY.alreadyResolved)
  return reply('failed', `resolve_${o.report.toLowerCase()}`, RESOLVE_COPY.failed)
}
