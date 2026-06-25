/**
 * AI Lead Qualifier — TEMPORARY draft-review store (P2.5 canary).
 *
 * Persists each draft turn's output so the canary is reviewable. Write-only from the
 * worker's perspective: nothing in the send path reads this, so it can never affect a
 * customer. Remove together with the qualify_draft_review table when the canary ends.
 */
import { db } from '@/config/db'
import type { Qualification } from '@/lib/inbox/autoresponse/qualification'
import type { EscalationSummary } from '@/lib/inbox/autoresponse/summary'

export interface QualifyDraftInput {
  conversationId: number
  agencyId: number
  decision: 'send' | 'escalate'
  escalationReason: string | null
  replyText: string
  extracted: Qualification
  qualification: Qualification
  summary: EscalationSummary | null
  lang: string
  turnCount: number
}

export async function insertQualifyDraftReview(input: QualifyDraftInput): Promise<void> {
  await db('qualify_draft_review').insert({
    conversationId: input.conversationId,
    agencyId: input.agencyId,
    decision: input.decision,
    escalationReason: input.escalationReason,
    replyText: input.replyText,
    extracted: JSON.stringify(input.extracted ?? {}),
    qualification: JSON.stringify(input.qualification ?? {}),
    summaryText: input.summary?.text ?? null,
    suggestedAction: input.summary?.suggestedAction ?? null,
    temperature: input.summary?.temperature ?? null,
    lang: input.lang,
    turnCount: input.turnCount,
  })
}

export interface QualifyDraftRow extends QualifyDraftInput {
  id: number
  createdAt: string
}

/** Most-recent drafts for an agency, newest first (for canary inspection). */
export async function getRecentQualifyDrafts(agencyId: number, limit = 20): Promise<QualifyDraftRow[]> {
  const rows = await db('qualify_draft_review')
    .where({ agencyId })
    .orderBy('createdAt', 'desc')
    .limit(limit)
  return rows.map((r) => ({
    id: Number(r.id),
    conversationId: Number(r.conversationId),
    agencyId: Number(r.agencyId),
    decision: r.decision,
    escalationReason: r.escalationReason ?? null,
    replyText: r.replyText,
    extracted: (typeof r.extracted === 'string' ? JSON.parse(r.extracted) : r.extracted) ?? {},
    qualification: (typeof r.qualification === 'string' ? JSON.parse(r.qualification) : r.qualification) ?? {},
    summary: r.summaryText
      ? { text: r.summaryText, suggestedAction: r.suggestedAction ?? '', temperature: r.temperature }
      : null,
    lang: r.lang,
    turnCount: Number(r.turnCount),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }))
}
