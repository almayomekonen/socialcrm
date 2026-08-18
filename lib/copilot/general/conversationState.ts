/**
 * ConversationState — last-turn snapshot for General Mode follow-ups.
 * Derived from the previous assistant answer the UI already holds.
 * It is NOT chat memory and never reaches the LLM.
 */
import { fromAnswer } from './conversationStateFromAnswer'

export type FactBucketId =
  | 'tasks.overdue'
  | 'followups.dueToday'
  | 'leads.notContactedRecently'
  | 'leads.newThisWeek'
  | 'meetings.today'
  | 'inbox.unread'

export type ConversationLead = { id: number; name: string }

export type ConversationAnswerKind = 'data' | 'reasoned' | 'lead' | 'guide'

export interface ConversationState {
  surfacedRefIds: string[]
  executiveDecision: string
  whys: string[]
  answerKind: ConversationAnswerKind
  intent: string | null
  rankedLeads: ConversationLead[]
  consumedLeadIds: string[]
  subjectLead: ConversationLead | null
  reason: string | null
  expandedBucketIds: FactBucketId[]
  ranking: { overdueTotal: number; dueTodayTotal: number; staleTotal: number } | null
}

export const FACT_BUCKET_ORDER: FactBucketId[] = [
  'tasks.overdue',
  'followups.dueToday',
  'inbox.unread',
  'leads.notContactedRecently',
  'meetings.today',
  'leads.newThisWeek',
]

const EMPTY: Omit<ConversationState, 'answerKind'> = {
  surfacedRefIds: [],
  executiveDecision: '',
  whys: [],
  intent: null,
  rankedLeads: [],
  consumedLeadIds: [],
  subjectLead: null,
  reason: null,
  expandedBucketIds: [],
  ranking: null,
}

function lead(id: number, name: string | null | undefined): ConversationLead {
  return { id, name: name?.trim() || 'ליד ללא שם' }
}

function unionIds(a: string[], b: string[]): string[] {
  const seen = new Set(a)
  const out = [...a]
  for (const id of b) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function unionBuckets(a: FactBucketId[], b: FactBucketId[]): FactBucketId[] {
  const seen = new Set(a)
  const out = [...a]
  for (const id of b) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function establishesNewRanking(s: ConversationState): boolean {
  return s.intent === 'crm.attention' || s.answerKind === 'reasoned' || s.answerKind === 'lead'
}

/** Who-else answers reuse a subset of the active ranking — not a new list context. */
function isRankingContinuation(prev: ConversationState, next: ConversationState): boolean {
  if (establishesNewRanking(next)) return false
  if (prev.rankedLeads.length === 0 || next.rankedLeads.length === 0) return false
  const prevIds = new Set(prev.rankedLeads.map((l) => l.id))
  return next.rankedLeads.every((l) => prevIds.has(l.id))
}

/** Explicit data/guide topics that do not carry a lead ranking. */
function clearsRanking(next: ConversationState): boolean {
  if (next.intent === 'guide') return true
  if (next.answerKind !== 'data') return false
  if (next.rankedLeads.length > 0) return false
  return next.intent != null
}

/** Merge a new turn onto the previous snapshot so unused buckets/leads accumulate. */
export function mergeConversationState(prev: ConversationState | null, next: ConversationState): ConversationState {
  if (!prev) return next
  const expandedBucketIds = unionBuckets(prev.expandedBucketIds, next.expandedBucketIds)

  if (establishesNewRanking(next)) {
    return { ...next, expandedBucketIds }
  }

  if (isRankingContinuation(prev, next)) {
    return {
      ...next,
      intent: prev.intent,
      rankedLeads: prev.rankedLeads,
      consumedLeadIds: unionIds(prev.consumedLeadIds, next.consumedLeadIds),
      surfacedRefIds: prev.rankedLeads.map((l) => String(l.id)),
      expandedBucketIds,
      subjectLead: prev.subjectLead,
      reason: prev.reason ?? next.reason,
      ranking: prev.ranking ?? next.ranking,
      executiveDecision: next.executiveDecision || prev.executiveDecision,
      whys: next.whys.length > 0 ? next.whys : prev.whys,
    }
  }

  if (next.rankedLeads.length > 0) {
    return { ...next, expandedBucketIds }
  }

  if (clearsRanking(next)) {
    return {
      ...next,
      expandedBucketIds,
      rankedLeads: [],
      consumedLeadIds: [],
      subjectLead: null,
      reason: null,
      ranking: null,
      surfacedRefIds: [],
      executiveDecision: next.executiveDecision,
      whys: next.whys,
    }
  }

  const rankedLeads = prev.rankedLeads.length > 0 ? prev.rankedLeads : next.rankedLeads
  return {
    ...next,
    intent: next.intent ?? prev.intent,
    rankedLeads,
    consumedLeadIds: unionIds(prev.consumedLeadIds, next.consumedLeadIds),
    surfacedRefIds: rankedLeads.map((l) => String(l.id)),
    expandedBucketIds,
    subjectLead: next.subjectLead ?? prev.subjectLead,
    reason: next.reason ?? prev.reason,
    ranking: next.ranking ?? prev.ranking,
    executiveDecision: next.executiveDecision || prev.executiveDecision,
    whys: next.whys.length > 0 ? next.whys : prev.whys,
  }
}

/** Build state from the previous answer, optionally merging the prior snapshot. */
export function toConversationState(
  answer: object | null | undefined,
  prev?: ConversationState | null,
): ConversationState | null {
  if (!answer) return prev ?? null
  const next = fromAnswer(answer as { kind: string } & Record<string, unknown>)
  if (!next) return prev ?? null
  return mergeConversationState(prev ?? null, next)
}

/** Accept the PR1 snapshot shape still used by older tests/callers. */
export function coerceConversationState(raw: unknown): ConversationState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<ConversationState>
  const rankedLeads = Array.isArray(o.rankedLeads) ? o.rankedLeads : []
  const fromRefs = Array.isArray(o.surfacedRefIds)
    ? o.surfacedRefIds
        .map((id) => Number(id))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((id) => lead(id, rankedLeads.find((l) => l.id === id)?.name))
    : []
  const ranked = rankedLeads.length > 0 ? rankedLeads : fromRefs
  return {
    ...EMPTY,
    ...o,
    answerKind: o.answerKind ?? (o.executiveDecision ? 'reasoned' : 'data'),
    intent: o.intent ?? null,
    rankedLeads: ranked,
    consumedLeadIds: Array.isArray(o.consumedLeadIds)
      ? o.consumedLeadIds
      : ranked[0]
        ? [String(ranked[0].id)]
        : [],
    subjectLead: o.subjectLead ?? ranked[0] ?? null,
    reason: o.reason ?? o.whys?.[0] ?? null,
    expandedBucketIds: Array.isArray(o.expandedBucketIds) ? o.expandedBucketIds : [],
    ranking: o.ranking ?? null,
    surfacedRefIds: Array.isArray(o.surfacedRefIds) ? o.surfacedRefIds : ranked.map((l) => String(l.id)),
    executiveDecision: o.executiveDecision ?? '',
    whys: Array.isArray(o.whys) ? o.whys : [],
  }
}
