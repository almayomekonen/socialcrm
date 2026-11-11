/**
 * The owner's ONE choice of how WhatsApp is answered — the 3-way method that
 * replaced two overlapping choices on /settings/auto-response (responder:
 * agent/questionnaire, and reply style: smart/fixed).
 *
 * Pure. The page, the form and the save action all derive from these functions,
 * so what the screen offers and what the server writes can never disagree.
 *
 * NO NEW COLUMN. The method is expressed in the three columns that already
 * exist, written together:
 *
 *   method          responder        replyMode   mode
 *   ai              'agent'          'ai'        'qualify' for the Smart Reply
 *                                                rollout; otherwise unchanged
 *   fixed           'agent'          'fixed'     'acknowledge'
 *   questionnaire   'questionnaire'  unchanged   unchanged
 *
 * The questionnaire leaves the agent's columns alone on purpose: switching back
 * restores the agent exactly as the owner left it.
 *
 * WHAT 'ai' RUNS. A conversation with the agent when `mode` ends up 'qualify'
 * (`aiConversational`); otherwise ONE AI-written reply per new conversation —
 * the `one_ai_reply` state, which the page labels as exactly that and never as
 * the conversational agent.
 */
import { resolveResponderChoice, type ResponderChoice, type ResponderChoiceInput } from './responderChoice'

export type ResponseMethod = 'ai' | 'questionnaire' | 'fixed'

export const RESPONSE_METHODS: readonly ResponseMethod[] = ['ai', 'questionnaire', 'fixed']

export function isResponseMethod(value: unknown): value is ResponseMethod {
  return value === 'ai' || value === 'questionnaire' || value === 'fixed'
}

/** The method the stored row describes. Mirrors resolveResponderChoice's `current`. */
export function storedMethod(choice: ResponderChoice | null, replyMode: string | null | undefined): ResponseMethod {
  if (!choice) return replyMode === 'fixed' ? 'fixed' : 'ai'
  if (choice.current === 'questionnaire') return 'questionnaire'
  if (choice.current === 'one_fixed_reply') return 'fixed'
  return 'ai'
}

/**
 * Will choosing 'ai' hold a conversation? True when the row is already
 * conversational, or when the save will make it so (the Smart Reply rollout,
 * `canUseSmartReplyAgent`) — the same rule `updateAutoResponseSettings` has
 * always applied when the owner picked smart reply.
 */
export function aiConversational(storedMode: string | null | undefined, smartReplyRollout: boolean): boolean {
  return storedMode === 'qualify' || smartReplyRollout
}

export type MethodWrite = {
  responder: 'agent' | 'questionnaire'
  /** Undefined: leave the stored reply style as it is. */
  replyMode?: 'ai' | 'fixed'
  /** Undefined: leave the stored engine mode as it is. */
  mode?: 'acknowledge' | 'qualify'
}

/** The columns a method writes (see the table above). */
export function methodWrite(method: ResponseMethod, smartReplyRollout: boolean): MethodWrite {
  if (method === 'questionnaire') return { responder: 'questionnaire' }
  if (method === 'fixed') return { responder: 'agent', replyMode: 'fixed', mode: 'acknowledge' }
  return { responder: 'agent', replyMode: 'ai', ...(smartReplyRollout ? { mode: 'qualify' as const } : {}) }
}

export type MethodRefusal = 'conflict' | 'unavailable'

/**
 * The server's check, run against the row as it is inside the save transaction.
 *
 * STALE WRITE. `from` is the method the page showed as stored. If the row now
 * says something else (another tab, another admin), the save is refused — never
 * an overwrite.
 *
 * ELIGIBILITY. The questionnaire keeps its existing rule (enabled for the agency
 * AND a valid published copy). 'ai' and 'fixed' are always runnable: the fixed
 * message is one verbatim reply, and 'ai' is either the conversational agent or
 * one AI reply, decided by `aiConversational`. The agent's old "must already be
 * conversational" rule existed only because switching away from the
 * questionnaire could not also write `mode`; this save writes both together.
 */
export function checkMethodChange(
  row: ResponderChoiceInput | null,
  input: { from: ResponseMethod; to: ResponseMethod },
): { ok: true } | { ok: false; reason: MethodRefusal } {
  const choice = row ? resolveResponderChoice(row) : null
  const stored = storedMethod(choice, row?.replyMode)
  if (stored !== input.from) return { ok: false, reason: 'conflict' }
  if (input.to === stored) return { ok: true }
  if (input.to === 'questionnaire' && !choice?.questionnaire.available) return { ok: false, reason: 'unavailable' }
  return { ok: true }
}
