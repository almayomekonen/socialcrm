/**
 * "בדיקת השאלון": a conversation with a definition, decided by production code.
 *
 * Nothing here decides anything. Every judgement — reading an answer, matching a
 * phrasing, a number, a multi-select, checking a date, "not decided yet", a
 * customer's question, a correction, a burst, a branch, which ending — is made
 * by the same functions the worker calls, on transcript rows shaped exactly like
 * the rows production stores:
 *
 *   turnFacts.inboundInputs → turnFacts.firstAskedAt → transition.decideQuestionnaireTurn
 *   → customerFacingText.finalizeCustomerFacingText (the send path's dash rewrite)
 *   → render.renderSummary / summaryFields
 *
 * The one thing production does in SQL rather than in a shared function is the
 * session bookkeeping after a decision (commitTurn / endSession / consumeUpTo
 * and the aiState transition in effects.ts). It is mirrored below, line for
 * line, and guarded by the parity test that runs the same conversations through
 * the real worker and through this simulator and requires identical results.
 *
 * Stateless: the whole conversation is replayed on every call, from the turns
 * the caller sends. Nothing is persisted or sent; no lead, no notification.
 * Out of scope (covered by runtime tests): a person taking over, the
 * service window, duplicate deliveries.
 */
import type { AiState } from '../../qualification'
import type { QuestionnaireDefinition } from '../definition'
import { decideQuestionnaireTurn, type SessionSnapshot, type TurnDecision } from '../transition'
import { firstAskedAt, inboundInputs } from '../turnFacts'
import { renderSummary, summaryFields } from '../render'
import { finalizeCustomerFacingText } from '../../customerFacingText'

export const MAX_SIMULATED_TURNS = 40

type Row = Record<string, unknown>

export type SimulatedTurn = {
  customer: string[]
  replies: string[]
  explanation: TurnExplanation
}

/** Why the turn went the way it did — read off the decision, never recomputed. */
export type TurnExplanation = {
  outcome: TurnDecision['kind']
  reason: string
  nextQuestionId: string | null
  attempts: number | null
  recognized: Array<{ questionId: string; optionIds?: string[]; text?: string; fromWords?: string; notSet?: true }>
  keptForRep: { unplaced: string[]; questions: string[]; corrections: string[] }
}

export type SimulationResult = {
  turns: SimulatedTurn[]
  status: SessionSnapshot['status'] | 'not_started'
  answers: Record<string, string[]>
  summary: { title: string; fields: Array<{ label: string; value: string }> }
}

const EXTRA_KEYS = { unplaced: ':unplaced', questions: ':questions', corrections: ':corrections' } as const

function explain(before: Record<string, string[]>, decision: TurnDecision): TurnExplanation {
  const after = decision.kind === 'none' ? before : decision.answers
  const recognized: TurnExplanation['recognized'] = []
  for (const key of Object.keys(after)) {
    if (key.includes(':') || before[key]) continue
    const raw = after[`${key}:raw`]?.[0]
    const notSet = after[`${key}:state`]?.[0] === 'not_set'
    recognized.push({ questionId: key, optionIds: after[key], ...(raw ? { fromWords: raw } : {}), ...(notSet ? { notSet: true as const } : {}) })
  }
  const added = (k: string) => (after[k] ?? []).filter((v) => !(before[k] ?? []).includes(v))
  return {
    outcome: decision.kind,
    reason: decision.reason,
    nextQuestionId: decision.kind === 'question' || decision.kind === 'record' ? decision.stepId : null,
    attempts: decision.kind === 'question' || decision.kind === 'record' ? decision.invalidCount : null,
    recognized,
    keptForRep: {
      unplaced: added(EXTRA_KEYS.unplaced),
      questions: added(EXTRA_KEYS.questions),
      corrections: added(EXTRA_KEYS.corrections),
    },
  }
}

/** effects.ts `applyAiState`: never resurrects a conversation a human owns or that opted out. */
function nextAiState(current: AiState, intent: 'active_turn' | 'escalate' | 'opt_out' | 'leave_alone'): AiState {
  if (intent === 'leave_alone') return current
  if (intent === 'opt_out') return 'opted_out'
  if (current === 'human_active' || current === 'opted_out') return current
  return intent === 'escalate' ? 'escalated' : 'ai_qualifying'
}

export function simulateConversation(definition: QuestionnaireDefinition, turns: readonly string[][]): SimulationResult {
  const rows: Row[] = []
  let sequence = 0
  let session: SessionSnapshot | null = null
  let aiState: AiState = 'new'
  const out: SimulatedTurn[] = []

  for (const messages of turns.slice(0, MAX_SIMULATED_TURNS)) {
    for (const text of messages) {
      rows.push({ direction: 'inbound', type: 'text', text, payload: {}, sequence: ++sequence, metadata: null, sentByUserId: null })
    }
    const active = session?.status === 'active' ? session : null
    const decision = decideQuestionnaireTurn({
      definition,
      session: session ? { ...session } : null,
      inputs: inboundInputs(rows, active ? active.lastConsumedSequence : 0),
      now: new Date(),
      routedToQuestionnaire: true,
      aiState,
      humanTookOver: false,
      hasPriorOutbound: rows.some((r) => r.direction === 'outbound'),
      leadStatusTerminal: false,
      firstAskedAt: active ? firstAskedAt(rows, active.id, active.currentStepId) : 0,
    })
    const before = active ? active.answers : {}
    const replies: string[] = []
    const now = new Date().toISOString()

    if (decision.kind === 'none') {
      // processJob: consumeUpTo, only for a live session.
      if (active && decision.consumeThrough != null) {
        session = { ...active, lastConsumedSequence: Math.max(active.lastConsumedSequence, decision.consumeThrough) }
      }
    } else if (decision.kind === 'terminal') {
      // finalizeTerminal → persistTerminal (endSession + applyAiState), then the closing send.
      if (active) {
        session = {
          ...active,
          status: decision.status,
          answers: decision.answers,
          lastConsumedSequence: decision.consumeThrough ?? active.lastConsumedSequence,
          version: active.version + 1,
        }
        aiState = nextAiState(aiState, decision.status === 'opted_out' ? 'opt_out' : decision.escalate ? 'escalate' : 'leave_alone')
      }
      if (decision.text) {
        const body = finalizeCustomerFacingText(decision.text)
        rows.push({ direction: 'outbound', type: 'text', text: body, payload: {}, sequence: ++sequence, metadata: { source: 'auto_response', kind: 'questionnaire_closing' }, sentByUserId: null })
        replies.push(body)
      }
    } else {
      // 'question' (startSession when it starts one, send, commitTurn) and 'record' (commitTurn, no send).
      let live: SessionSnapshot | null = active
      if (decision.kind === 'question' && decision.startsSession) {
        live = { id: 1, status: 'active', currentStepId: null, answers: {}, invalidCount: 0, lastConsumedSequence: 0, lastPromptAt: null, version: 0 }
      }
      if (live) {
        if (decision.kind === 'question') {
          const body = finalizeCustomerFacingText(decision.text)
          rows.push({
            direction: 'outbound',
            type: 'text',
            text: body,
            payload: {},
            sequence: ++sequence,
            metadata: { source: 'auto_response', kind: 'questionnaire', questionnaireTurnKey: `${live.id}:v${live.version}`, questionnaireStepId: decision.stepId },
            sentByUserId: null,
          })
          replies.push(body)
        }
        session = {
          ...live,
          currentStepId: decision.stepId,
          answers: decision.answers,
          invalidCount: decision.invalidCount,
          lastConsumedSequence: decision.consumeThrough,
          lastPromptAt: now,
          version: live.version + 1,
        }
        aiState = nextAiState(aiState, 'active_turn')
      }
    }
    out.push({ customer: [...messages], replies, explanation: explain(before, decision) })
  }

  const answers = session?.answers ?? {}
  const complete = session?.status === 'completed'
  const title = renderSummary(definition, answers, { complete }).split('\n')[0]
  return {
    turns: out,
    status: session?.status ?? 'not_started',
    answers,
    summary: { title, fields: summaryFields(definition, answers) },
  }
}
