/**
 * Which of the two response methods (AI conversational agent / structured
 * questionnaire) is active for an agency's WhatsApp, and which of them it can
 * actually switch to. Pure: the page and the switch action both call this with
 * the stored row and the agency's flags, so what the screen offers and what the
 * server accepts can never disagree.
 *
 * WHAT THE WORKER DOES (db/questionnaireJobs.ts, worker.ts):
 * - `responder = 'questionnaire'` sends every job to the questionnaire worker.
 *   It speaks only when WA_QUESTIONNAIRE_* allows the agency AND the published
 *   copy (`questionnaire` column) validates. Otherwise it stays silent and hands
 *   the conversation to a person. It never falls through to the AI.
 * - Any other responder is the agent. It holds a conversation only in
 *   `mode = 'qualify'` (where `replyMode` is ignored). In `acknowledge` mode it
 *   sends ONE reply, AI-written or fixed, and stops. That is not a
 *   conversational agent, so the AI card is never offered for it.
 *
 * The owner's settings save only ever moves `mode` to 'qualify' for agencies in
 * the Smart Reply rollout. This module never widens that: the agent is
 * available exactly when the stored mode is already conversational.
 */

export type ResponderKind = 'agent' | 'questionnaire'

/** What new incoming WhatsApp messages get right now. */
export type CurrentResponse = 'agent' | 'questionnaire' | 'one_ai_reply' | 'one_fixed_reply'

export type UnavailableReason = 'agent_not_conversational' | 'questionnaire_not_enabled' | 'questionnaire_not_published'

export type OptionState = { available: true } | { available: false; reason: UnavailableReason }

export type ResponderChoice = {
  /** The persisted `responder`, normalised the way getChannelSettings reads it. */
  stored: ResponderKind
  /** The card shown as selected. Null when neither describes what runs. */
  active: ResponderKind | null
  current: CurrentResponse
  /** Stored as questionnaire, but the questionnaire cannot speak. */
  questionnaireStalled: boolean
  agent: OptionState
  questionnaire: OptionState
}

export type ResponderChoiceInput = {
  responder: string | null | undefined
  mode: string | null | undefined
  replyMode: string | null | undefined
  /** canUseWhatsappQuestionnaire(agencyId). */
  questionnaireAllowed: boolean
  /** parseQuestionnaireDefinition(row.questionnaire).ok — a valid published copy exists. */
  questionnairePublished: boolean
}

export function normaliseResponder(value: string | null | undefined): ResponderKind {
  return value === 'questionnaire' ? 'questionnaire' : 'agent'
}

export function resolveResponderChoice(input: ResponderChoiceInput): ResponderChoice {
  const stored = normaliseResponder(input.responder)
  const conversational = input.mode === 'qualify'

  const agent: OptionState = conversational ? { available: true } : { available: false, reason: 'agent_not_conversational' }
  const questionnaire: OptionState = !input.questionnaireAllowed
    ? { available: false, reason: 'questionnaire_not_enabled' }
    : !input.questionnairePublished
      ? { available: false, reason: 'questionnaire_not_published' }
      : { available: true }

  if (stored === 'questionnaire') {
    return {
      stored,
      active: 'questionnaire',
      current: 'questionnaire',
      questionnaireStalled: !questionnaire.available,
      agent,
      questionnaire,
    }
  }
  const current: CurrentResponse = conversational ? 'agent' : input.replyMode === 'fixed' ? 'one_fixed_reply' : 'one_ai_reply'
  return { stored, active: conversational ? 'agent' : null, current, questionnaireStalled: false, agent, questionnaire }
}

/** Can the owner move from what is stored to `to`? The single rule both sides use. */
export function canSwitchResponder(choice: ResponderChoice, to: ResponderKind): boolean {
  return choice.stored !== to && choice[to].available
}
