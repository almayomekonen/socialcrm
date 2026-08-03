import type { SubjectDefinition } from '../types'

/**
 * Registered subjects (frozen spec §3.4, and the note under it).
 *
 * Modelled as catalog entities rather than a hardcoded union so that §12 open
 * question 1 (closed list vs open per integration) stays genuinely open while
 * validation stays strict: an event's `subject` must reference one of these,
 * and CI rejects an unregistered value.
 *
 * B1 registers only `lead`, because that is the only subject the shipped
 * engine has events for. Adding `appointment`, `payment`, `webinar` and
 * `conversation` is a catalog change when their events arrive — not a code
 * change.
 */
export const SUBJECT_ENTRIES: readonly SubjectDefinition[] = [
  { key: 'lead', title: 'לידים', icon: 'user' },
  // B7 adds `appointment` for the first external event. Exactly as predicted
  // above: a catalog row, not a code change.
  { key: 'appointment', title: 'פגישות', icon: 'calendar' },
]
