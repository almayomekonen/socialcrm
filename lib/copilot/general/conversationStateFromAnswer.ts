import { buildAttentionDecision, type AttentionPayload } from './attentionDecision'
import type { ReasonedAnswer } from './reasonedAnswer'
import type { ConversationLead, ConversationState, FactBucketId } from './conversationState'

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

function dedupe(leads: ConversationLead[]): ConversationLead[] {
  const seen = new Set<number>()
  const out: ConversationLead[] = []
  for (const l of leads) {
    if (seen.has(l.id)) continue
    seen.add(l.id)
    out.push(l)
  }
  return out
}

function listLeads(sample: { id: number; name: string | null }[] | undefined): ConversationLead[] {
  return (sample ?? []).map((r) => lead(r.id, r.name))
}

function fromReasoned(a: ReasonedAnswer): ConversationState | null {
  if (a.allClear || a.actions.length === 0) return null
  const rankedLeads = dedupe(
    a.actions.filter((x) => x.leadId != null).map((x) => lead(x.leadId as number, x.action)),
  )
  const first = rankedLeads[0] ?? null
  return {
    ...EMPTY,
    answerKind: 'reasoned',
    surfacedRefIds: rankedLeads.map((l) => String(l.id)),
    executiveDecision: a.executiveDecision,
    whys: a.actions.map((x) => x.why),
    rankedLeads,
    consumedLeadIds: first ? [String(first.id)] : [],
    subjectLead: first,
    reason: a.actions[0]?.why ?? null,
  }
}

function fromOverview(): ConversationState {
  return {
    ...EMPTY,
    answerKind: 'data',
    intent: 'system.overview',
    expandedBucketIds: [],
  }
}

function fromAttention(payload: {
  overdue: { total: number; sample: { id: number; name: string | null }[] }
  dueToday: { total: number; sample: { id: number; name: string | null }[] }
  stale: { total: number; sample: { id: number; name: string | null }[] }
}): ConversationState {
  const rankedLeads = dedupe([
    ...listLeads(payload.overdue.sample),
    ...listLeads(payload.dueToday.sample),
    ...listLeads(payload.stale.sample),
  ])
  const decision = buildAttentionDecision(payload as AttentionPayload)
  const subjectLead = rankedLeads[0] ?? null
  return {
    ...EMPTY,
    answerKind: 'data',
    intent: 'crm.attention',
    surfacedRefIds: rankedLeads.map((l) => String(l.id)),
    rankedLeads,
    consumedLeadIds: subjectLead ? [String(subjectLead.id)] : [],
    subjectLead,
    reason: decision?.reason ?? null,
    executiveDecision: decision ? `הכי דחוף כרגע: ${decision.leadName}` : '',
    expandedBucketIds: ['tasks.overdue', 'followups.dueToday', 'leads.notContactedRecently'],
    ranking: {
      overdueTotal: payload.overdue.total,
      dueTodayTotal: payload.dueToday.total,
      staleTotal: payload.stale.total,
    },
  }
}

function fromLeadList(
  intent: FactBucketId,
  payload: { total: number; sample: { id: number; name: string | null }[] },
): ConversationState {
  const rankedLeads = listLeads(payload.sample)
  return {
    ...EMPTY,
    answerKind: 'data',
    intent,
    surfacedRefIds: rankedLeads.map((l) => String(l.id)),
    rankedLeads,
    consumedLeadIds: rankedLeads.map((l) => String(l.id)),
    expandedBucketIds: [intent],
  }
}

function fromLeadCard(l: { id: number; name: string }): ConversationState {
  const subjectLead = lead(l.id, l.name)
  return {
    ...EMPTY,
    answerKind: 'lead',
    rankedLeads: [subjectLead],
    consumedLeadIds: [String(subjectLead.id)],
    surfacedRefIds: [String(subjectLead.id)],
    subjectLead,
  }
}

function fromData(intent: string, payload: unknown): ConversationState | null {
  if (intent === 'system.overview') return fromOverview()
  if (intent === 'crm.attention' && payload && typeof payload === 'object') {
    return fromAttention(payload as Parameters<typeof fromAttention>[0])
  }
  if (intent === 'inbox.unread') {
    return { ...EMPTY, answerKind: 'data', intent: 'inbox.unread', expandedBucketIds: ['inbox.unread'] }
  }
  if (intent === 'meetings.today') {
    return { ...EMPTY, answerKind: 'data', intent: 'meetings.today', expandedBucketIds: ['meetings.today'] }
  }
  if (
    intent === 'followups.dueToday' ||
    intent === 'leads.notContactedRecently' ||
    intent === 'tasks.overdue' ||
    intent === 'leads.newThisWeek'
  ) {
    const p = payload as { total?: number; sample?: { id: number; name: string | null }[] }
    if (Array.isArray(p?.sample)) return fromLeadList(intent, { total: p.total ?? p.sample.length, sample: p.sample })
  }
  return { ...EMPTY, answerKind: 'data', intent }
}

type AnswerLike = { kind: string } & Record<string, unknown>

/** Derive structured state from one assistant answer. Fallback/leadPick keep prior state. */
export function fromAnswer(answer: AnswerLike): ConversationState | null {
  if (answer.kind === 'fallback' || answer.kind === 'leadPick') return null
  if (answer.kind === 'reasoned') return fromReasoned(answer as unknown as ReasonedAnswer)
  if (answer.kind === 'data') return fromData(String(answer.intent ?? ''), answer.payload)
  if (answer.kind === 'lead' && answer.lead && typeof answer.lead === 'object') {
    return fromLeadCard(answer.lead as { id: number; name: string })
  }
  if (answer.kind === 'guide' && typeof answer.answer === 'string') {
    const route = typeof answer.route === 'string' ? answer.route : ''
    return {
      ...EMPTY,
      answerKind: 'guide',
      executiveDecision: answer.answer,
      intent: route ? 'guide' : null,
    }
  }
  if (answer.kind === 'leadAnswer' && typeof answer.leadName === 'string') {
    return {
      ...EMPTY,
      answerKind: 'guide',
      executiveDecision: String(answer.text ?? ''),
      reason: String(answer.text ?? ''),
    }
  }
  return null
}
