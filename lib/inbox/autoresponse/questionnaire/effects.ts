/**
 * Writing down what a turn decided.
 *
 * One transaction per turn, covering the session, the conversation's ownership
 * state and the rep-facing summary. Either all three move or none does, so
 * there is no state in which a customer has been asked something the session
 * does not know about, or answers exist that no rep can see.
 *
 * The summary is rewritten on EVERY turn, not only at the end. That is what
 * makes the guarantee in the brief hold: if the closing message cannot be
 * delivered, if a rep takes over mid-questionnaire, if the process dies — the
 * answers collected so far are already durable and already visible.
 */
import type { Knex } from 'knex'
import { db } from '@/config/db'
import { upsertConversationIntelligence, getMaxMessageSequence } from '@/db/conversationIntelligence'
import { commitTurn, endSession } from '@/db/questionnaireSessions'
import type { QuestionnaireDefinition } from './definition'
import { renderSummary, summaryFields } from './render'
import type { QuestionnaireSessionStatus } from './transition'

export const QUESTIONNAIRE_ANALYZER_VERSION = 'questionnaire-v1'

/** How ownership should move. Never resurrects a conversation a human owns. */
type AiStateIntent = 'active_turn' | 'escalate' | 'opt_out' | 'leave_alone'

async function applyAiState(
  trx: Knex.Transaction,
  args: { agencyId: number; conversationId: number; intent: AiStateIntent; reason: string },
): Promise<void> {
  if (args.intent === 'leave_alone') return

  // Sourced FROM the conversation, so a conversationId belonging to another
  // agency writes nothing. Same construction as the Human Presence writers.
  const insertState =
    args.intent === 'escalate' ? 'escalated' : args.intent === 'opt_out' ? 'opted_out' : 'ai_qualifying'

  await trx.raw(
    `INSERT INTO conversation_ai_state
       ("conversationId","agencyId","aiState","aiTurnCount","aiLastAt","escalatedAt","escalationReason","stoppedReason")
     SELECT c.id, c."agencyId", :insertState,
            CASE WHEN :counts THEN 1 ELSE 0 END, now(),
            CASE WHEN :escalate THEN now() ELSE NULL END,
            CASE WHEN :escalate THEN :reason ELSE NULL END,
            CASE WHEN :optOut THEN :reason ELSE NULL END
       FROM inbox_conversations c
      WHERE c.id = :conversationId AND c."agencyId" = :agencyId
     ON CONFLICT ("conversationId") DO UPDATE SET
       "aiState" = CASE
         -- The customer's own stop outranks everything, including a rep.
         WHEN :optOut THEN 'opted_out'
         -- Never speak over, or for, a conversation a human owns.
         WHEN conversation_ai_state."aiState" IN ('human_active','opted_out') THEN conversation_ai_state."aiState"
         WHEN :escalate THEN 'escalated'
         ELSE 'ai_qualifying'
       END,
       "aiTurnCount" = conversation_ai_state."aiTurnCount" + CASE WHEN :counts THEN 1 ELSE 0 END,
       "aiLastAt" = now(),
       "escalatedAt" = CASE WHEN :escalate THEN now() ELSE conversation_ai_state."escalatedAt" END,
       "escalationReason" = CASE WHEN :escalate THEN :reason ELSE conversation_ai_state."escalationReason" END,
       "stoppedReason" = CASE WHEN :optOut THEN :reason ELSE conversation_ai_state."stoppedReason" END,
       "updatedAt" = now()`,
    {
      agencyId: args.agencyId,
      conversationId: args.conversationId,
      insertState,
      counts: args.intent === 'active_turn',
      escalate: args.intent === 'escalate',
      optOut: args.intent === 'opt_out',
      reason: args.reason,
    },
  )
}

/**
 * The note a rep reads, written from a fixed template into the row the inbox
 * banner already renders. `fields` carries the same answers unformatted, so the
 * banner can list them without parsing prose.
 */
export async function writeQuestionnaireSummary(
  trx: Knex.Transaction,
  args: {
    agencyId: number
    conversationId: number
    definition: QuestionnaireDefinition
    answers: Record<string, string[]>
    complete: boolean
    status: QuestionnaireSessionStatus
    endedReason: string | null
  },
): Promise<void> {
  const coveredSequence = await getMaxMessageSequence(args.conversationId)
  await upsertConversationIntelligence(
    {
      conversationId: args.conversationId,
      agencyId: args.agencyId,
      channel: 'whatsapp',
      kind: 'qualification_summary',
      status: 'fresh',
      schemaVersion: 1,
      analyzerVersion: QUESTIONNAIRE_ANALYZER_VERSION,
      coveredSequence,
      data: {
        text: renderSummary(args.definition, args.answers, { complete: args.complete }),
        fields: summaryFields(args.definition, args.answers),
        source: 'questionnaire',
        complete: args.complete,
        sessionStatus: args.status,
        endedReason: args.endedReason,
        // Deliberately no `suggestedAction`: that field is the AI analyzer's
        // advice, and this row is a transcript of what the customer said.
        suggestedAction: null,
      },
    },
    trx,
  )
}

/** A question was asked. Advance only if the session is still where we left it. */
export async function persistQuestionTurn(args: {
  agencyId: number
  conversationId: number
  sessionId: number
  version: number
  leadId: number | null
  definition: QuestionnaireDefinition
  stepId: string
  answers: Record<string, string[]>
  invalidCount: number
  lastConsumedSequence: number
}): Promise<boolean> {
  return db.transaction(async (trx) => {
    const moved = await commitTurn(trx, {
      agencyId: args.agencyId,
      sessionId: args.sessionId,
      version: args.version,
      currentStepId: args.stepId,
      answers: args.answers,
      invalidCount: args.invalidCount,
      lastConsumedSequence: args.lastConsumedSequence,
      leadId: args.leadId,
    })
    if (!moved) return false

    await applyAiState(trx, {
      agencyId: args.agencyId,
      conversationId: args.conversationId,
      intent: 'active_turn',
      reason: 'questionnaire',
    })
    await writeQuestionnaireSummary(trx, {
      agencyId: args.agencyId,
      conversationId: args.conversationId,
      definition: args.definition,
      answers: args.answers,
      complete: false,
      status: 'active',
      endedReason: null,
    })
    return true
  })
}

export type TerminalPersistArgs = {
  agencyId: number
  conversationId: number
  sessionId: number
  leadId: number | null
  definition: QuestionnaireDefinition
  answers: Record<string, string[]>
  status: Exclude<QuestionnaireSessionStatus, 'active'>
  endedReason: string
  lastConsumedSequence: number | null
  escalate: boolean
  complete: boolean
}

/**
 * The session is over. Runs BEFORE any closing message is attempted, because
 * the answers reaching the rep must not depend on WhatsApp accepting one more
 * message.
 */
export async function persistTerminal(args: TerminalPersistArgs): Promise<boolean> {
  return db.transaction(async (trx) => {
    const ended = await endSession(trx, {
      agencyId: args.agencyId,
      sessionId: args.sessionId,
      status: args.status,
      endedReason: args.endedReason,
      answers: args.answers,
      lastConsumedSequence: args.lastConsumedSequence,
      leadId: args.leadId,
    })
    if (!ended) return false

    const intent: AiStateIntent =
      args.status === 'opted_out'
        ? 'opt_out'
        : args.escalate
          ? 'escalate'
          : 'leave_alone'
    await applyAiState(trx, {
      agencyId: args.agencyId,
      conversationId: args.conversationId,
      intent,
      reason: args.endedReason,
    })
    await writeQuestionnaireSummary(trx, {
      agencyId: args.agencyId,
      conversationId: args.conversationId,
      definition: args.definition,
      answers: args.answers,
      complete: args.complete,
      status: args.status,
      endedReason: args.endedReason,
    })
    return true
  })
}
