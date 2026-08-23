/**
 * Single source of truth for lead-status classification used across the
 * follow-up rule engine and the copilot context layer.
 *
 * Both modules previously declared these sets independently with a comment
 * cross-referencing each other ("if you change one, audit the other"). That
 * coupling is unsafe — extracting it here makes the contract explicit and
 * the call sites narrower.
 *
 * THE PERSISTED VOCABULARY IS ENGLISH. `clients.status` stores the keys declared
 * in `lib/leads/statusStyles.ts` and mirrored as catalog data in
 * `lib/automations/catalog/entries/events.ts`:
 *
 *     new | contacted | interested | closed | lost
 *
 * These sets originally held only the Hebrew LABELS, so they matched no row:
 * every real status fell through to the `cool` catch-all. The consequences were
 * user-visible — `classifyLeadStatus('closed')` returned `cool`, so
 * `buildLeadSuggestedActions` (which suppresses only on `terminal`) kept
 * offering sales actions on closed and lost leads, and `followUpPulse` never
 * fell silent for a terminal lead.
 *
 * The Hebrew members are retained as LEGACY ALIASES so any historical row
 * written before the English keys still classifies correctly. They are a
 * superset, never a substitute: never remove an English key.
 */

/** Statuses that close the lead — copilot suppresses suggestions, follow-up
 *  rule engine returns null. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  // Persisted vocabulary.
  'closed',
  'lost',
  // Legacy aliases.
  'לא רלוונטי',
  'לא מעוניין',
  'סגורה',
  'הסתיים טיפול',
  'הועבר לנציג אחר',
])

/** Statuses that indicate active engagement requiring follow-up vigilance. */
export const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  // Persisted vocabulary.
  'new',
  'contacted',
  'interested',
  // Legacy aliases.
  'חדש',
  'בטיפול',
  'ממתין לתשובה',
])
