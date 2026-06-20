import type { ConversationActionData, OperatorTakeRow } from '@/db/conversationIntelligence'

/**
 * Pure render-time gate for the Operator Take. NO imports from `lib/ai/*` — this
 * module runs in the render path. It decides whether a persisted suggested-action
 * earns a visible take (Law 4 silence + §9.2 non-obviousness), and assigns the
 * shadow-holdout arm. This is the file the §9.2 acceptance test targets.
 */

export type RenderableTake = {
  takeId: string
  actionMessage: string
  reason: string
  sourceMessageIds: number[]
  stale: boolean
}

/** Obvious restatements that must never surface even if mislabeled by the model. */
const OBVIOUS_DENYLIST: RegExp[] = [
  /ממתין(ה)? לתשוב/, // "waiting for a reply"
  /עברו\s+\S+\s+ימים/, // "X days have passed"
  /הכדור\s+אצל(ך|ם)/, // "the ball is in your/their court"
]

export function isObviousRestatement(text: string): boolean {
  const t = text.trim()
  return OBVIOUS_DENYLIST.some((re) => re.test(t))
}

/** The non-obviousness gate (§9.2). True only when the take earns its place. */
export function passesNonObvious(data: Pick<ConversationActionData, 'actionMessage' | 'noveltyKind'>): boolean {
  const msg = data.actionMessage?.trim() ?? ''
  if (!msg) return false
  if (data.noveltyKind === 'none' || !data.noveltyKind) return false
  if (isObviousRestatement(msg)) return false
  return true
}

/** Deterministic ~20% holdout via FNV-1a over the conversation id. */
export function isHoldout(conversationId: number): boolean {
  let h = 0x811c9dc5
  for (const ch of String(conversationId)) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % 5 === 0
}

export function takeId(conversationId: number, coveredSequence: number): string {
  return `${conversationId}:${coveredSequence}`
}

/**
 * The render-time selection. Returns the take to show, or null to render nothing
 * (Law 4 silence). Caller decides shown-vs-holdout separately via isHoldout().
 */
export function selectRenderableTake(conversationId: number, row: OperatorTakeRow | null): RenderableTake | null {
  if (!row) return null
  if (row.status === 'failed') return null
  const d = row.data
  if (!d || d.suggestedAction === 'none') return null
  if (!d.sourceMessageIds || d.sourceMessageIds.length === 0) return null // Law 1: ungrounded → drop
  if (!passesNonObvious(d)) return null // §9.2 non-obviousness gate
  return {
    takeId: takeId(conversationId, row.coveredSequence),
    actionMessage: d.actionMessage as string,
    reason: d.reason ?? '',
    sourceMessageIds: d.sourceMessageIds,
    stale: row.status === 'stale',
  }
}
