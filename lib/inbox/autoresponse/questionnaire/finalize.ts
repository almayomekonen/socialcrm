/**
 * Ending a questionnaire: completed, handed to a person, opted out, or parked
 * because we do not know what happened to a message.
 *
 * SAVE FIRST, SEND SECOND. Every path here writes the answers, the session's
 * outcome and the rep-facing summary BEFORE it tries to say anything to the
 * customer. A closing message WhatsApp refuses must cost the business nothing
 * more than a missing goodbye; the lead's details are the part that matters,
 * and they are already durable by the time a send is attempted.
 */
import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import type { AutoResponseJob } from '@/db/autoResponseJobs'
import { readSessionForConversation } from '@/db/questionnaireSessions'
import { sendIreOutbound } from '../ireSend'
import type { QuestionnaireDefinition } from './definition'
import { persistTerminal } from './effects'
import { ensureLeadForConversation, notifyQuestionnaireHandoff, recordSummaryTaskNote } from './handoffEffects'
import { renderSummary } from './render'
import type { TurnDecision } from './transition'
import { QUESTIONNAIRE_SEND_TIMEOUT_MS, type QuestionnaireDeps } from './types'

/** Save, then try to say goodbye. Never the other way round. */
export async function finalizeTerminal(
  job: AutoResponseJob,
  conv: Record<string, unknown>,
  definition: QuestionnaireDefinition,
  decision: Extract<TurnDecision, { kind: 'terminal' }>,
  opts: {
    deliver: boolean
    deps: QuestionnaireDeps
    leadId: number | null
    /** False when a person spoke while this turn ran: the goodbye is theirs to say. */
    stillOurs?: () => Promise<boolean>
  },
): Promise<'done' | 'ambiguous'> {
  const session = await readSessionForConversation(job.agencyId, job.conversationId)
  let leadId = opts.leadId
  if (decision.escalate) {
    leadId = (await ensureLeadForConversation({ agencyId: job.agencyId, conversationId: job.conversationId })) ?? leadId
  }

  if (session && session.status === 'active') {
    await persistTerminal({
      agencyId: job.agencyId,
      conversationId: job.conversationId,
      sessionId: session.id,
      leadId,
      definition,
      answers: decision.answers,
      status: decision.status,
      endedReason: decision.reason,
      lastConsumedSequence: decision.consumeThrough,
      escalate: decision.escalate,
      complete: decision.complete,
    })
  }

  if (decision.escalate && leadId) {
    const summary = renderSummary(definition, decision.answers, { complete: decision.complete })
    await db
      .transaction(async (trx) => {
        await recordSummaryTaskNote(trx, { agencyId: job.agencyId, leadId: leadId as number, summary })
        await notifyQuestionnaireHandoff(trx, {
          agencyId: job.agencyId,
          leadId: leadId as number,
          leadName: (conv.customerName as string | null) ?? null,
          complete: decision.complete,
        })
      })
      .catch((err) => {
        // The answers are already saved and already visible in the inbox. A
        // failure to add a task or a bell row must not undo that.
        console.error('[questionnaire] handoff side effects failed', { conversationId: job.conversationId, err: String(err) })
      })
  }

  if (!opts.deliver || !decision.text) return 'done'
  if (opts.stillOurs && !(await opts.stillOurs())) return 'done'

  const sent = await sendIreOutbound(
    job,
    {
      conv: {
        id: Number(conv.id),
        businessPhoneNumberId: String(conv.businessPhoneNumberId),
        customerWaId: (conv.customerWaId as string | null) ?? null,
        customerName: (conv.customerName as string | null) ?? null,
      },
      lead: { userId: null, handlerId: null },
    },
    opts.deps.send,
    decision.text,
    { source: 'auto_response', reason: job.reason, phase: 2, kind: 'questionnaire_closing' },
    { timeoutMs: QUESTIONNAIRE_SEND_TIMEOUT_MS, skipAnalysis: true },
  )
  if (sent.ok === false) {
    console.warn('[questionnaire] closing message not delivered', {
      conversationId: job.conversationId,
      reason: sent.reason,
      ambiguous: Boolean(sent.ambiguous),
    })
    return sent.ambiguous ? 'ambiguous' : 'done'
  }
  return 'done'
}

/** An unknown send outcome: stop, save everything, and ask for a person. */
export async function parkForReview(
  job: AutoResponseJob,
  conv: Record<string, unknown>,
  definition: QuestionnaireDefinition,
  answers: Record<string, string[]>,
  sessionId: number,
  leadId: number | null,
): Promise<void> {
  const resolvedLeadId =
    (await ensureLeadForConversation({ agencyId: job.agencyId, conversationId: job.conversationId })) ?? leadId
  await persistTerminal({
    agencyId: job.agencyId,
    conversationId: job.conversationId,
    sessionId,
    leadId: resolvedLeadId,
    definition,
    answers,
    status: 'needs_review',
    endedReason: 'send_outcome_unknown',
    lastConsumedSequence: null,
    escalate: true,
    complete: false,
  })
  if (resolvedLeadId) {
    const summary = renderSummary(definition, answers, { complete: false })
    await db
      .transaction(async (trx) => {
        await recordSummaryTaskNote(trx, { agencyId: job.agencyId, leadId: resolvedLeadId, summary })
        await notifyQuestionnaireHandoff(trx, {
          agencyId: job.agencyId,
          leadId: resolvedLeadId,
          leadName: (conv.customerName as string | null) ?? null,
          complete: false,
        })
      })
      .catch((err) => console.error('[questionnaire] park side effects failed', { err: String(err) }))
  }
  await track({
    agencyId: job.agencyId,
    event: 'auto_response_skipped',
    props: { conversationId: job.conversationId, reason: 'send_outcome_unknown', mode: 'questionnaire' },
  })
}
