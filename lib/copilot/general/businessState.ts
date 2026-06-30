/**
 * Business State Engine — deterministic classification of facts into operational
 * business states. Pure function of facts: same facts → identical states, no LLM,
 * no user intent, no presentation. A state must be true even with every LLM deleted.
 *
 * States are CLASSIFICATIONS (what kind of situation), never DECISIONS — ranking and
 * importance belong exclusively to the Reasoner. The Engine emits facts, deterministic
 * measurements, derived state, and provenance only.
 */
import type { FactsBundle, FactRow, FactSource } from './facts/types'

export type BusinessStateKind =
  | 'BROKEN_COMMITMENT' // a committed task is past due
  | 'WAITING_CUSTOMER' // promised a reply, the customer is waiting
  | 'GOING_COLD' // not contacted long enough to slip off the radar
  | 'FOLLOWUP_DUE' // a follow-up is scheduled for today
  | 'NEW_LEAD' // a fresh first-contact opportunity

export interface BusinessState {
  state: BusinessStateKind
  /** The lead this state is about — the citation key the Trust Gate validates. */
  refId: string
  name: string
  /** The measurable fact supporting the state, in words (deterministic). */
  evidence: string
  metadata: {
    ageDays: number | null
    source: FactSource
    /** Deterministic measurements (objective-neutral). */
    waitingDays: number | null
    freshnessDays: number | null
    clusterSize: number
  }
}

/** Each fact source maps to exactly one operational state (count-only sources omitted). */
const SOURCE_STATE: Partial<Record<FactSource, BusinessStateKind>> = {
  'tasks.overdue': 'BROKEN_COMMITMENT',
  'followups.promisedWaiting': 'WAITING_CUSTOMER',
  'leads.notContactedRecently': 'GOING_COLD',
  'followups.dueToday': 'FOLLOWUP_DUE',
  'leads.newThisWeek': 'NEW_LEAD',
  // 'inbox.unread' has no per-entity rows → handled as a count by the Situation Report.
}

function evidenceFor(kind: BusinessStateKind, ageDays: number | null): string {
  switch (kind) {
    case 'BROKEN_COMMITMENT':
      return ageDays != null ? `באיחור ${ageDays} ימים` : 'התחייבות שהופרה'
    case 'GOING_COLD':
      return ageDays != null ? `${ageDays} ימים בלי קשר` : 'מזמן לא בקשר'
    case 'WAITING_CUSTOMER':
      return 'ממתין לתשובה שהובטחה'
    case 'FOLLOWUP_DUE':
      return 'מעקב מתוכנן להיום'
    case 'NEW_LEAD':
      return 'נכנס השבוע'
  }
}

export function classifyStates(facts: FactsBundle): BusinessState[] {
  const states: BusinessState[] = []
  for (const group of facts.groups) {
    const kind = SOURCE_STATE[group.source]
    if (!kind) continue
    for (const r of group.rows as FactRow[]) {
      states.push({
        state: kind,
        refId: r.refId,
        name: r.name,
        evidence: evidenceFor(kind, r.ageDays),
        metadata: {
          ageDays: r.ageDays,
          source: group.source,
          waitingDays: r.waitingDays ?? null,
          freshnessDays: r.freshnessDays ?? null,
          clusterSize: group.total,
        },
      })
    }
  }
  return states
}
