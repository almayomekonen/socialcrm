'use server'

import { requireAgencyUser } from '@/lib/requireUser'
import { db } from '@/config/db'
import { listConversationMessages } from '@/db/aiMessages'
import { mapMessageRowToTimelineEntry, type TimelineEntry } from '@/lib/copilot/timeline'

/**
 * Read-only Phase 2 hydration. Resolves the active conversation for the lead
 * (does NOT create one — creation happens on first write via
 * persistAssistantTurn) and returns the ordered timeline.
 *
 * Tenant isolation: scoped to the caller's agencyId. Cannot reach across
 * agencies even if the caller passes a leadId that belongs to a different one.
 *
 * Returns chronologically ascending entries (oldest first). The panel renders
 * top-to-bottom; the composer sits below.
 */

const TIMELINE_HARD_LIMIT = 100

export type CopilotTimelineResponse =
  | { ok: true; conversationId: number | null; entries: TimelineEntry[] }
  | { ok: false; reason: 'invalid-input' | 'forbidden' | 'unavailable' }

export async function getCopilotTimeline(leadIdRaw: number | string): Promise<CopilotTimelineResponse> {
  const leadId = Number(leadIdRaw)
  if (!Number.isFinite(leadId) || leadId <= 0) return { ok: false, reason: 'invalid-input' }

  let user
  try {
    user = await requireAgencyUser()
  } catch {
    return { ok: false, reason: 'forbidden' }
  }

  try {
    const conv = await db('ai_conversations')
      .where({ agencyId: user.agencyId, leadId, state: 'active' })
      .first('id')

    if (!conv) return { ok: true, conversationId: null, entries: [] }

    const conversationId = Number(conv.id)
    const rowsDesc = await listConversationMessages({
      conversationId,
      agencyId: user.agencyId,
      limit: TIMELINE_HARD_LIMIT,
    })

    // listConversationMessages returns DESC by sequence; reverse for the
    // chronological timeline. Phase 2 caps at the most-recent 100 — older
    // history is intentionally hidden until Phase 3 introduces cursor paging.
    const entries = rowsDesc
      .slice()
      .reverse()
      .map(mapMessageRowToTimelineEntry)
      .filter((e): e is TimelineEntry => e !== null)

    return { ok: true, conversationId, entries }
  } catch (err) {
    console.warn('[ai] getCopilotTimeline.fail', (err as Error)?.message)
    return { ok: false, reason: 'unavailable' }
  }
}
