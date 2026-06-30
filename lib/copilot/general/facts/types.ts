/**
 * Facts contract (Phase 1 — Situation Assembly).
 *
 * The single, deterministic, provenance-tagged fact bundle handed to the
 * reasoning call. Every row carries a `refId` (the citation key the Truth Gate
 * validates) and its `source` (provenance). The reasoner sees ONLY this — never
 * the raw DB (Architecture: the truth boundary; Constitution Principle 1).
 *
 * `FactSource` reuses the existing general-mode vocabulary (registry intent ids)
 * — no new concepts introduced.
 */

export type FactSource =
  | 'tasks.overdue'
  | 'followups.dueToday'
  | 'leads.notContactedRecently'
  | 'leads.newThisWeek'
  | 'followups.promisedWaiting'
  | 'inbox.unread'

/** One real, citeable item, tagged with where it came from. */
export interface FactRow {
  /** String(lead id) — the only key the reasoner may cite; validated by the Truth Gate. */
  refId: string
  name: string
  status: string | null
  /** Age signal (days overdue / days since contact), when the source provides it. */
  ageDays: number | null
  /** Deterministic measurement: days the customer has been waiting (promised-waiting source). */
  waitingDays?: number | null
  /** Deterministic measurement: days since the lead was created (new-lead source). */
  freshnessDays?: number | null
  source: FactSource
}

/** A source's contribution: its true total + a sampled set of rows. */
export interface FactGroup {
  source: FactSource
  total: number
  rows: FactRow[]
  /** Count-only sources (e.g. inbox) carry their numbers here. */
  meta?: Record<string, number>
}

/** The whole curated situation for one request. */
export interface FactsBundle {
  groups: FactGroup[]
}
