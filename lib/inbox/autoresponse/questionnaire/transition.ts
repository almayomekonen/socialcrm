/**
 * The questionnaire state machine. Pure, total, and the only place a turn is
 * decided.
 *
 * TWO KINDS OF OUTCOME, AND THE DIFFERENCE MATTERS.
 *
 *   'question' — we are asking for something. The session may only advance once
 *     that question is known to have been sent, or the customer would be left
 *     waiting for a message that never arrived, at a step they never saw.
 *
 *   'terminal' — the conversation is leaving the questionnaire: completed,
 *     handed to a person, opted out. Here the state is saved FIRST and the
 *     message is best effort, because the answers already collected must reach
 *     the rep even if the closing message cannot be delivered. Losing a lead's
 *     details to a failed send would be the worst outcome in the system.
 *
 * Nothing here decides anything by asking a model, and nothing here may start.
 * An input this file cannot read produces a re-prompt or a handoff, never a
 * guess and never a fallback to the AI agent.
 *
 * NOTE: ~340 lines, over the 250-line soft limit, intentionally. It is one pure
 * function and its helpers: every rule of the conversation in one place, read
 * top to bottom in priority order. Splitting it by rule would scatter a
 * decision table that only makes sense as a whole, and the priority between
 * rules — an opt-out outranking a handoff outranking an answer — would stop
 * being visible.
 */
import type { AiState } from '../qualification'
import {
  findStep,
  nextStepAfter,
  answerStateKey,
  rawAnswerKey,
  type QuestionnaireDefinition,
  type QuestionnaireStep,
} from './definition'
import {
  detectCommand,
  joinTextInputs,
  normalizeForMatch,
  parseChoice,
  parseFreeText,
  type InboundKind,
} from './parseAnswer'
import { parseSelectionId } from './interactive'
import { closingFor } from './closing'
import { checkTextAnswer } from './validateAnswer'
import { renderOpening, renderQuestion, renderReprompt, renderRestart, type RepromptReason } from './render'

export type QuestionnaireSessionStatus =
  | 'active'
  | 'completed'
  | 'handed_off'
  | 'opted_out'
  | 'human_took_over'
  | 'needs_review'

export type SessionSnapshot = {
  id: number
  status: QuestionnaireSessionStatus
  currentStepId: string | null
  answers: Record<string, string[]>
  invalidCount: number
  lastConsumedSequence: number
  lastPromptAt: string | null
  version: number
}

export type InboundInput = {
  sequence: number
  kind: InboundKind
  text: string
  /**
   * A tapped reply button / list row: `<stepId>.<optionId>` (interactive.ts).
   * Its `text` is the option's label, for the inbox; the id is what counts.
   */
  selectedId?: string
}

export type TurnFacts = {
  definition: QuestionnaireDefinition
  session: SessionSnapshot | null
  inputs: readonly InboundInput[]
  now: Date
  /** Env flag and the stored responder, read at processing time, not at enqueue. */
  routedToQuestionnaire: boolean
  aiState: AiState
  /** A human-authored outbound exists in this conversation. */
  humanTookOver: boolean
  /** Any earlier outbound at all, which means this is not a fresh conversation. */
  hasPriorOutbound: boolean
  leadStatusTerminal: boolean
}

export type TurnDecision =
  | { kind: 'none'; reason: string; consumeThrough: number | null }
  | {
      kind: 'question'
      reason: string
      text: string
      stepId: string
      answers: Record<string, string[]>
      invalidCount: number
      consumeThrough: number
      startsSession: boolean
    }
  | {
      kind: 'terminal'
      reason: string
      /** Null when the conversation must end in silence (opt out, takeover). */
      text: string | null
      status: Exclude<QuestionnaireSessionStatus, 'active'>
      answers: Record<string, string[]>
      consumeThrough: number | null
      /** Mark the conversation as waiting for a rep, and write the summary. */
      escalate: boolean
      complete: boolean
    }

export function decideQuestionnaireTurn(facts: TurnFacts): TurnDecision {
  const { definition, session, inputs } = facts
  const active = session && session.status === 'active' ? session : null
  const consumeThrough = inputs.length ? Math.max(...inputs.map((i) => i.sequence)) : null
  const answers = active ? { ...active.answers } : {}

  // ── Routing withdrawn ────────────────────────────────────────────────────
  // The business was switched back to the agent, the flag was pulled, or the
  // definition stopped validating. A conversation already mid-questionnaire is
  // handed to a person with whatever it collected. It is never handed to the AI.
  if (!facts.routedToQuestionnaire) {
    if (!active) return { kind: 'none', reason: 'not_routed', consumeThrough: null }
    return terminal('engine_disabled', 'handed_off', definition.handoff, answers, consumeThrough, true, false)
  }

  // ── A person owns the conversation ───────────────────────────────────────
  if (facts.humanTookOver || facts.aiState === 'human_active') {
    if (!active) return { kind: 'none', reason: 'human_active', consumeThrough: null }
    return terminal('human_active', 'human_took_over', null, answers, consumeThrough, false, false)
  }
  if (facts.aiState === 'opted_out') {
    return { kind: 'none', reason: 'opted_out', consumeThrough: null }
  }

  if (!inputs.length) return { kind: 'none', reason: 'no_pending_inbound', consumeThrough: null }

  // ── Commands, scanned across everything that arrived this turn ────────────
  // Typed text only: a tapped option is never a command, even if an owner
  // labelled an option "נציג".
  const commands = inputs.filter((i) => i.kind === 'text' && !i.selectedId).map((i) => detectCommand(i.text))
  if (commands.includes('opt_out')) {
    return terminal('opt_out', 'opted_out', null, answers, consumeThrough, false, false)
  }
  if (commands.includes('human')) {
    return terminal('human_request', 'handed_off', definition.handoff, answers, consumeThrough, true, false)
  }

  // ── No session yet: may this conversation start one? ──────────────────────
  if (!active) {
    if (session && session.status !== 'active') {
      return { kind: 'none', reason: 'session_closed', consumeThrough }
    }
    if (facts.leadStatusTerminal) return { kind: 'none', reason: 'lead_terminal', consumeThrough: null }
    if (facts.hasPriorOutbound) return { kind: 'none', reason: 'not_eligible_existing', consumeThrough: null }
    if (facts.aiState !== 'new') return { kind: 'none', reason: 'not_eligible_state', consumeThrough: null }
    const first = nextStepAfter(definition, {}, null)
    if (!first) return { kind: 'none', reason: 'definition_empty', consumeThrough: null }
    return {
      kind: 'question',
      reason: 'started',
      text: renderOpening(definition, first),
      stepId: first.id,
      answers: {},
      invalidCount: 0,
      consumeThrough: consumeThrough as number,
      startsSession: true,
    }
  }

  // ── Restart, only while a session is live ────────────────────────────────
  if (commands.includes('restart')) {
    const first = nextStepAfter(definition, {}, null)
    if (!first) return { kind: 'none', reason: 'definition_empty', consumeThrough: null }
    return {
      kind: 'question',
      reason: 'restarted',
      text: renderRestart(definition, first),
      stepId: first.id,
      answers: {},
      invalidCount: 0,
      consumeThrough: consumeThrough as number,
      startsSession: false,
    }
  }

  // ── Abandoned and come back much later ───────────────────────────────────
  // No nudge was ever sent and none is sent now. The rep picks it up with the
  // partial answers rather than the customer resuming a script they have
  // forgotten the beginning of.
  if (isExpired(active, definition, facts.now)) {
    return terminal('expired', 'handed_off', definition.handoff, answers, consumeThrough, true, false)
  }

  const step = findStep(definition, active.currentStepId)
  if (!step) {
    // The definition changed under a live session in a way its snapshot cannot
    // explain. Hand it to a person instead of improvising a question.
    return terminal('step_missing', 'handed_off', definition.handoff, answers, consumeThrough, true, false)
  }

  const textInputs = inputs.filter((i) => i.kind === 'text')
  if (!textInputs.length) {
    const hasVoice = inputs.some((i) => i.kind === 'voice')
    const hasMedia = inputs.some((i) => i.kind === 'media')
    if (!hasVoice && !hasMedia) {
      // Reactions and unknown types: consumed, answered with silence.
      return { kind: 'none', reason: 'ignorable_only', consumeThrough }
    }
    return reprompt(facts, active, step, hasVoice ? 'voice' : 'media', answers, consumeThrough as number)
  }

  // ── The answer itself ────────────────────────────────────────────────────
  if (step.type === 'choice') {
    // Newest readable selection wins: a customer who writes "2" and then "no, 3"
    // has corrected themselves, and the correction is the answer.
    // A tap is resolved by its id, never its label, and only for THIS question:
    // a tap on an earlier question's buttons is stale and answers nothing.
    for (let i = textInputs.length - 1; i >= 0; i--) {
      const input = textInputs[i]
      if (input.selectedId) {
        const tapped = parseSelectionId(input.selectedId)
        if (tapped?.stepId === step.id && step.options.some((o) => o.id === tapped.optionId)) {
          return advance(facts, active, step, { [step.id]: [tapped.optionId] }, consumeThrough as number)
        }
        continue
      }
      const parsed = parseChoice(input.text, step)
      if (parsed.ok) {
        // Read from the customer's own words: keep them for the rep, too.
        const raw = parsed.via === 'alias' ? { [rawAnswerKey(step.id)]: [normalizeForMatch(input.text).slice(0, 300)] } : {}
        return advance(facts, active, step, { [step.id]: parsed.optionIds, ...raw }, consumeThrough as number)
      }
    }
    const typed = textInputs.filter((i) => !i.selectedId)
    const lastParse = typed.length ? parseChoice(typed[typed.length - 1].text, step) : null
    // `=== false` rather than `!`: this codebase's TS does not narrow a
    // discriminated union on the negation.
    const reason: RepromptReason =
      lastParse?.ok === false && lastParse.reason === 'too_many' ? 'invalid_multi' : 'invalid_choice'
    return reprompt(facts, active, step, reason, answers, consumeThrough as number)
  }

  // A free-text question is answered by typing; a stale tap is not an answer.
  const typedText = textInputs.filter((i) => !i.selectedId)
  if (!typedText.length) {
    return reprompt(facts, active, step, 'invalid_text', answers, consumeThrough as number)
  }
  const joined = joinTextInputs(typedText.map((i) => i.text))
  const parsed = parseFreeText(joined)
  if (!parsed.ok) {
    return reprompt(facts, active, step, 'invalid_text', answers, consumeThrough as number)
  }
  // Opt-in per question; without `validate` every non-empty reply is the answer.
  const checked = checkTextAnswer(step.validate, parsed.value)
  if (!checked.ok) {
    return reprompt(facts, active, step, 'invalid_text', answers, consumeThrough as number)
  }
  const state = checked.notSet ? { [answerStateKey(step.id)]: ['not_set'] } : {}
  return advance(facts, active, step, { [step.id]: [parsed.value], ...state }, consumeThrough as number)
}

function advance(
  facts: TurnFacts,
  session: SessionSnapshot,
  step: QuestionnaireStep,
  answer: Record<string, string[]>,
  consumeThrough: number,
): TurnDecision {
  const answers = { ...session.answers, ...answer }
  const next = nextStepAfter(facts.definition, answers, step.id)
  if (!next) {
    return terminal('completed', 'completed', closingFor(facts.definition, answers), answers, consumeThrough, true, true)
  }
  return {
    kind: 'question',
    reason: 'answered',
    text: renderQuestion(next),
    stepId: next.id,
    answers,
    invalidCount: 0,
    consumeThrough,
    startsSession: false,
  }
}

function reprompt(
  facts: TurnFacts,
  session: SessionSnapshot,
  step: QuestionnaireStep,
  reason: RepromptReason,
  answers: Record<string, string[]>,
  consumeThrough: number,
): TurnDecision {
  const invalidCount = session.invalidCount + 1
  if (invalidCount > facts.definition.maxInvalidAttempts) {
    return terminal('invalid_limit', 'handed_off', facts.definition.handoff, answers, consumeThrough, true, false)
  }
  return {
    kind: 'question',
    reason: `reprompt_${reason}`,
    text: renderReprompt(step, reason),
    stepId: step.id,
    answers,
    invalidCount,
    consumeThrough,
    startsSession: false,
  }
}

function terminal(
  reason: string,
  status: Exclude<QuestionnaireSessionStatus, 'active'>,
  text: string | null,
  answers: Record<string, string[]>,
  consumeThrough: number | null,
  escalate: boolean,
  complete: boolean,
): TurnDecision {
  return { kind: 'terminal', reason, status, text, answers, consumeThrough, escalate, complete }
}

function isExpired(session: SessionSnapshot, definition: QuestionnaireDefinition, now: Date): boolean {
  if (!session.lastPromptAt) return false
  const promptedAt = new Date(session.lastPromptAt).getTime()
  if (!Number.isFinite(promptedAt)) return false
  return now.getTime() - promptedAt > definition.expireAfterHours * 60 * 60 * 1000
}
