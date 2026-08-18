import { classifyConversationIntent, type ConversationIntent } from './conversationIntent'
import {
  FACT_BUCKET_ORDER,
  type ConversationLead,
  type ConversationState,
  type FactBucketId,
} from './conversationState'

export type Continuation =
  | { kind: 'guide'; answer: string }
  | { kind: 'data'; intent: string; payload: unknown }

export const NOTHING_MORE = 'אין כרגע משהו נוסף שדורש תשומת לב.'
export const NO_MORE_LEADS = 'אין לידים נוספים ברשימה הזו.'
const WHO_ELSE_COUNT = 3

export function hasUsableFollowUpState(state: ConversationState | null, intent: ConversationIntent): boolean {
  if (!state || intent === 'none') return false
  if (intent === 'follow_up') return true
  if (intent === 'why') return !!(state.subjectLead && (state.reason || state.whys[0]))
  if (intent === 'who_else') return state.rankedLeads.length > 0
  return !!(state.executiveDecision.trim() || state.subjectLead)
}

export function explainWhy(state: ConversationState): string | null {
  const name = state.subjectLead?.name
  const reason = state.reason || state.whys[0]
  if (!name || !reason) return null
  let text = `${name} נמצא ראשון כי ${reason}.`
  const r = state.ranking
  if (r && r.overdueTotal === 0 && r.dueTodayTotal === 0) {
    text += ' אין כרגע משימה באיחור או מעקב להיום שמקדים אותו, ולכן הוא בראש רשימת הלידים שדורשים טיפול.'
  }
  return text
}

export function remainingLeads(state: ConversationState): ConversationLead[] {
  const consumed = new Set(state.consumedLeadIds)
  return state.rankedLeads.filter((l) => !consumed.has(String(l.id)))
}

export function nextLeads(state: ConversationState, n = WHO_ELSE_COUNT): ConversationLead[] {
  return remainingLeads(state).slice(0, n)
}

export function nextStepCopy(state: ConversationState): string | null {
  if (state.executiveDecision.trim()) return state.executiveDecision
  if (state.subjectLead) return `הצעד הבא: ליצור קשר עם ${state.subjectLead.name}.`
  return null
}

function isMaterial(intent: FactBucketId, payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  if (intent === 'inbox.unread') {
    const p = payload as { conversations?: number; unread?: number }
    return (p.conversations ?? 0) > 0 || (p.unread ?? 0) > 0
  }
  if (intent === 'meetings.today') {
    const p = payload as { meetings?: unknown[] }
    return Array.isArray(p.meetings) && p.meetings.length > 0
  }
  return ((payload as { total?: number }).total ?? 0) > 0
}

function whoElseAnswer(state: ConversationState): Continuation {
  const remaining = remainingLeads(state)
  if (remaining.length === 0) return { kind: 'guide', answer: NO_MORE_LEADS }
  const sample = remaining.slice(0, WHO_ELSE_COUNT)
  const intent = state.intent && state.intent !== 'crm.attention' && state.intent !== 'system.overview'
    ? state.intent
    : 'leads.notContactedRecently'
  return {
    kind: 'data',
    intent,
    payload: {
      total: remaining.length,
      sample: sample.map((l) => ({ id: l.id, name: l.name, status: null })),
    },
  }
}

export async function resolveFollowUp(
  text: string,
  state: ConversationState | null,
  loadIntent: (intent: FactBucketId) => Promise<unknown>,
): Promise<Continuation | null> {
  const intent = classifyConversationIntent(text)
  if (!hasUsableFollowUpState(state, intent) || !state) return null

  if (intent === 'why') {
    const answer = explainWhy(state)
    return answer ? { kind: 'guide', answer } : null
  }
  if (intent === 'who_else') return whoElseAnswer(state)
  if (intent === 'how' || intent === 'now') {
    const answer = nextStepCopy(state)
    return answer ? { kind: 'guide', answer } : null
  }

  for (const bucket of FACT_BUCKET_ORDER) {
    if (state.expandedBucketIds.includes(bucket)) continue
    const payload = await loadIntent(bucket)
    if (!isMaterial(bucket, payload)) continue
    return { kind: 'data', intent: bucket, payload }
  }
  return { kind: 'guide', answer: NOTHING_MORE }
}
