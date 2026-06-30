/**
 * Executive Situation Report — a PURE SERIALIZER.
 *
 * It presents Business States and their deterministic measurements; it makes NO
 * executive judgment. No importance ordering, no consequence-first ordering, no
 * consequence framing, no criticality marker, no importance-based truncation.
 * Ranking is the Reasoner's exclusive job. Output is permutation-invariant —
 * states are sorted by refId and sections follow a fixed neutral order — so the
 * serializer cannot encode salience.
 */
import type { BusinessState, BusinessStateKind } from './businessState'
import type { FactsBundle } from './facts/types'
import type { Objective } from './objective'

/** Neutral, objective-independent enumeration order (alphabetical by kind). Not a ranking. */
const ORDER: BusinessStateKind[] = ['BROKEN_COMMITMENT', 'FOLLOWUP_DUE', 'GOING_COLD', 'NEW_LEAD', 'WAITING_CUSTOMER']

/** Neutral, factual labels — the state's name, with no consequence/importance framing. */
const LABEL: Record<BusinessStateKind, string> = {
  BROKEN_COMMITMENT: 'משימות באיחור',
  WAITING_CUSTOMER: 'ממתינים לתשובה',
  GOING_COLD: 'לא נוצר קשר לאחרונה',
  FOLLOWUP_DUE: 'מעקב להיום',
  NEW_LEAD: 'לידים חדשים השבוע',
}

/** Serialize a state's deterministic measurements (no interpretation, no ranking). */
function measures(s: BusinessState): string {
  const parts = [s.evidence]
  if (s.metadata.waitingDays != null) parts.push(`${s.metadata.waitingDays} ימים בהמתנה`)
  if (s.metadata.freshnessDays != null) parts.push(`נוצר לפני ${s.metadata.freshnessDays} ימים`)
  return parts.filter(Boolean).join(' · ')
}

function inboxLine(facts: FactsBundle): string | null {
  const g = facts.groups.find((x) => x.source === 'inbox.unread')
  if (!g || g.total <= 0) return null
  return `ממתינים בתיבה: ${g.total} הודעות ב-${g.meta?.conversations ?? 0} שיחות`
}

function section(kind: BusinessStateKind, states: BusinessState[]): string | null {
  // Deterministic neutral order (by refId) → permutation-invariant; no severity sort, no top-N.
  const items = states.filter((s) => s.state === kind).sort((a, b) => a.refId.localeCompare(b.refId))
  if (items.length === 0) return null
  const clusterSize = items[0].metadata.clusterSize
  const lines = items.map((s) => `  - refId=${s.refId} · ${s.name} · ${measures(s)}`).join('\n')
  const more = clusterSize > items.length ? `\n  (ועוד ${clusterSize - items.length})` : ''
  return `${LABEL[kind]} (${clusterSize}):\n${lines}${more}`
}

export function buildSituationReport(objective: Objective, states: BusinessState[], facts: FactsBundle): string {
  // summarize: counts-only (the "how's the business" grain), neutral labels.
  if (objective === 'summarize') {
    const lines: string[] = []
    for (const kind of ORDER) {
      const items = states.filter((s) => s.state === kind)
      if (items.length > 0) lines.push(`${LABEL[kind]}: ${items[0].metadata.clusterSize}`)
    }
    const inbox = inboxLine(facts)
    if (inbox) lines.push(inbox)
    return lines.join('\n') || 'אין מצבים פעילים כרגע.'
  }

  // serialize all states + measurements, neutrally ordered; no ranking, no truncation.
  const blocks: string[] = []
  for (const kind of ORDER) {
    const sec = section(kind, states)
    if (sec) blocks.push(sec)
  }
  const inbox = inboxLine(facts)
  if (inbox) blocks.push(inbox)
  return blocks.join('\n\n') || 'אין מצבים פעילים כרגע.'
}
