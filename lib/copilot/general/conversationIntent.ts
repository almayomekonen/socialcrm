/**
 * Conversation Intent — deterministic discourse-act detector (PR1: follow-up only).
 *
 * Runs before inferObjective. It recognizes ONLY bare follow-up utterances
 * ("anything else?", "what else?", "continue") — exact, normalized matches, so a
 * real business question that merely contains a word is never hijacked. Anything
 * else returns 'none' and flows to the existing pipeline unchanged.
 *
 * Scope is intentionally narrow: no explanation, comparison, topic-switch, or
 * greeting handling here. Those are separate PRs.
 */

export type ConversationIntent = 'follow_up' | 'none'

/** Bare follow-up phrases (normalized: trimmed, lowercased, trailing punctuation removed). */
const FOLLOW_UP = new Set([
  'anything else',
  'what else',
  'continue',
  'go on',
  'keep going',
  'more',
  'עוד משהו',
  'מה עוד',
  'תמשיך',
  'המשך',
  'עוד',
])

export function classifyConversationIntent(text: string): ConversationIntent {
  const t = text.trim().toLowerCase().replace(/[?!.־\s]+$/u, '')
  return FOLLOW_UP.has(t) ? 'follow_up' : 'none'
}
