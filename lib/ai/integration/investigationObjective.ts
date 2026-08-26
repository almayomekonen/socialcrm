import type { ExpectationKind } from './detectors/registry'

/**
 * The investigation objective — what the system asks GPT to find out.
 *
 * SYSTEM-AUTHORED AND DETERMINISTIC. The model receives this text; it never
 * chooses it, rewrites it, or influences which one is used. That is the whole
 * point: an objective the model could steer is an objective the model could use
 * to widen its own remit, and the Agent's authority is supposed to be decided
 * entirely outside the model.
 *
 * There is no interpolation of lead data here — no name, no phone, no status.
 * The subject reaches the Agent through its SCOPE and its tools, which are
 * permission-bounded reads; putting customer identity into the prompt string
 * would route it around exactly those bounds.
 *
 * Total over `ExpectationKind`, enforced by the compiler in the same way
 * `notificationOwnership.ts` and `preconditions.ts` are: a new detector cannot
 * reach production without someone deciding what question it makes worth asking.
 */
export const INVESTIGATION_OBJECTIVE: Record<ExpectationKind, string> = {
  'followup.overdue':
    'Investigate this overdue follow-up. Determine what the lead was waiting for, what the latest conversation/context indicates, whether the expected follow-up is still relevant, and what concrete action the business should take now. Base every conclusion on cited CRM evidence. Do not invent missing facts.',
  'sla.open_loop':
    'This lead was answered and then the conversation stopped, with no follow-up scheduled and no open task. Determine what the customer was last waiting for, whether anything they asked for remains unresolved, whether the conversation reached a natural end, and what concrete action the business should take now. Base every conclusion on cited CRM evidence. Do not invent missing facts.',
  'conversation.unanswered':
    'This customer sent a message and no person has replied to it. Determine what they asked for, whether any part of it was already handled by an automated reply, whether the request is still open, and what concrete answer the business owes them now. Base every conclusion on cited CRM evidence. Do not invent missing facts.',
  'conversation.objection':
    'This customer raised an objection, already identified by the deterministic classifier. Determine what the objection actually is, whether it was addressed in the conversation that followed, whether it is a recurring theme for this lead, and what concrete response the business should give. Do not re-judge whether an objection occurred — that is established. Base every conclusion on cited CRM evidence. Do not invent missing facts.',
  'conversation.stalled':
    'This conversation showed real commercial engagement, was answered, and then stopped, with nothing scheduled. Determine what the customer was engaged about, whether their last point was resolved, whether the silence reads as a decision or as a dropped thread, and what concrete step would restart it. Base every conclusion on cited CRM evidence. Do not invent missing facts.',
}

/** The objective for an expectation, or null when none is declared. */
export function objectiveFor(expectation: string): string {
  const known = INVESTIGATION_OBJECTIVE[expectation as ExpectationKind]
  if (typeof known !== 'string' || known.length === 0) {
    // Unreachable through admission, which rejects an undeclared expectation at
    // P1. Asserted rather than defaulted: a fabricated objective would be the
    // system inventing its own question.
    throw new Error(`investigationObjective: no declared objective for '${expectation}'`)
  }
  return known
}
