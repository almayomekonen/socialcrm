/**
 * ConversationState — the lightweight last-turn snapshot the Conversation Intent
 * layer reads. It is NOT chat memory and never reaches the LLM; it is derived
 * from the previous assistant answer the UI already holds.
 *
 * PR1 uses only its PRESENCE (was the prior turn a real recommendation?) to decide
 * whether a follow-up should reassure. The other fields are populated now for the
 * later PRs (explanation reads `whys`/`executiveDecision`; continue/comparison read
 * `surfacedRefIds`). `objective` is added when the re-run path is implemented — the
 * current answer shape does not carry it.
 */
import type { ReasonedAnswer } from './reasonedAnswer'

export interface ConversationState {
  /** Lead ids surfaced last turn, in display order. */
  surfacedRefIds: string[]
  /** The prior executive decision sentence. */
  executiveDecision: string
  /** Per-recommendation reasons, same order as surfacedRefIds. */
  whys: string[]
}

/** Build state from the previous answer. Returns null unless it was a reasoned recommendation. */
export function toConversationState(answer: { kind: string } | null | undefined): ConversationState | null {
  if (!answer || answer.kind !== 'reasoned') return null
  const a = answer as ReasonedAnswer
  if (a.allClear || a.actions.length === 0) return null
  return {
    surfacedRefIds: a.actions.map((x) => (x.leadId != null ? String(x.leadId) : '')).filter(Boolean),
    executiveDecision: a.executiveDecision,
    whys: a.actions.map((x) => x.why),
  }
}
