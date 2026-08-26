import { db } from '@/config/db'
import { getAgencyId } from '@/db/agencies'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { scopedLeads, type Scope } from '@/db/briefing'
import { AUTO_RESPONSE_SOURCE, TERMINAL_STATUSES } from '@/lib/today/constants'
import type { LeadFact } from '@/lib/today/types'

// Today brief — FACTS ONLY. This layer derives raw per-lead facts; it contains no
// qualifying logic (that lives solely in lib/today/classify.ts). Scope (INV-5)
// and terminal exclusion (INV-3) come from the reused scopedLeads gate; thresholds
// flow in from lib/today/constants. Timestamps are normalized to epoch ms.

export type { Scope }

function toMs(v: unknown): number | null {
  if (v == null) return null
  const t = (v instanceof Date ? v : new Date(v as string)).getTime()
  return Number.isNaN(t) ? null : t
}

function toLeadFact(r: Record<string, unknown>): LeadFact {
  return {
    id: Number(r.id),
    name: (r.name as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    leadSource: (r.leadSource as string | null) ?? null,
    createdAt: toMs(r.createdAt),
    nextFollowUpAt: toMs(r.nextFollowUpAt),
    lastActivityAt: toMs(r.lastActivityAt),
    lastInboundAt: toMs(r.lastInboundAt),
    lastHumanOutboundAt: toMs(r.lastHumanOutboundAt),
    hasOpenTask: Boolean(r.hasOpenTask),
    earliestOpenTaskDueAt: toMs(r.earliestOpenTaskDueAt),
  }
}

/**
 * The Today brief's candidate-facts query (builder only — no execution, so it is
 * SQL-testable via .toSQL()). Returns every non-terminal, in-scope lead with the
 * facts the classifier needs.
 *
 * SINGLE SOURCE of the Today message aggregation: `last_inbound_at` and
 * `last_human_outbound_at` (Amendment C-2: a human outbound is one whose
 * metadata.source is NOT the AUTO_RESPONSE_SOURCE marker). The waiting-reply RULE is not here — it lives
 * only in classify.ts. briefing.ts keeps its own, differently-scoped aggregation
 * for the Copilot and is intentionally left untouched (C-2).
 */
export function candidateFactsQuery(agencyId: number, plan: string, scope: Scope) {
  const msg = db('inbox_messages as m')
    .join('inbox_conversations as cv', 'cv.id', 'm.conversationId')
    .where('m.agencyId', agencyId)
    .groupBy('cv.leadId')
    .select(
      'cv.leadId as lead_id',
      db.raw(`MAX(COALESCE(m."channelTimestamp", m."createdAt")) FILTER (WHERE m.direction = 'inbound') AS last_inbound_at`),
      db.raw(
        `MAX(COALESCE(m."channelTimestamp", m."createdAt")) FILTER (WHERE m.direction = 'outbound' AND (m.metadata->>'source') IS DISTINCT FROM ?) AS last_human_outbound_at`,
        [AUTO_RESPONSE_SOURCE],
      ),
    )

  return scopedLeads(agencyId, plan, scope)
    .whereNotIn('clients.status', [...TERMINAL_STATUSES])
    .leftJoin(db.raw('(?) as msg', [msg]), 'msg.lead_id', 'clients.id')
    .select(
      'clients.id',
      'clients.name',
      'clients.phone',
      'clients.status',
      'clients.leadSource',
      'clients.createdAt',
      'clients.nextFollowUpAt',
      'clients.lastActivityAt',
      db.raw('msg.last_inbound_at as "lastInboundAt"'),
      db.raw('msg.last_human_outbound_at as "lastHumanOutboundAt"'),
      db.raw(`EXISTS (SELECT 1 FROM tasks t WHERE t."clientId" = clients.id AND t.completed = false) AS "hasOpenTask"`),
      db.raw(
        `(SELECT MIN(t."dueDate") FROM tasks t WHERE t."clientId" = clients.id AND t.completed = false) AS "earliestOpenTaskDueAt"`,
      ),
    )
}

export async function getBriefCandidateFacts(scope: Scope): Promise<LeadFact[]> {
  const agencyId = scope.agencyId ?? (await getAgencyId())
  const plan = await getEffectiveLeadPlan(agencyId)
  const rows = (await candidateFactsQuery(agencyId, plan, scope)) as Record<string, unknown>[]
  return rows.map(toLeadFact)
}
