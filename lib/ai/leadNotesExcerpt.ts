import { redactIdNumbers } from '@/lib/leads/redactIdNumbers'

/** How many of the newest notes feed an AI prompt. The excerpt is bounded by length too. */
export const NOTES_IN_EXCERPT = 5
export const NOTES_EXCERPT_MAX_CHARS = 400

/**
 * The rep's notes (`lead_notes`, newest first) as one bounded text for an AI
 * prompt, with ID numbers masked.
 *
 * This is the ONLY text that fills `LeadIntelligenceInputs.detailsExcerpt`.
 * It used to be `clients.details`, which is a GENERATED identity label
 * (`firstName lastName (idNum)`, migration 20260414000001) and never notes:
 * it sent the ID number to the model as "הערות מילוליות".
 */
export function buildLeadNotesExcerpt(
  contents: Array<string | null | undefined>,
  knownIds: Array<string | null | undefined>,
  maxChars: number,
): string | null {
  const parts = contents
    .map((c) => (typeof c === 'string' ? c.replace(/\s+/g, ' ').trim() : ''))
    .filter((c) => c.length > 0)
  if (parts.length === 0) return null
  const text = redactIdNumbers(parts.join(' | '), knownIds)
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
}
