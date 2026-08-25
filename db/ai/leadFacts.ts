import { db } from '@/config/db'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { TERMINAL_STATUSES, AUTO_RESPONSE_SOURCE } from '@/lib/today/constants'
import type { LeadFact } from '@/lib/today/types'
import type { Scope } from '@/db/ai/stateManagement'

/**
 * Phase-1 signal detection — AGENCY-scoped lead facts.
 *
 * The Tier-1 sweep's roster (db/ai/roster.ts) answers "which relationships does
 * the runtime already hold beliefs about". This module answers the question the
 * runtime has never been able to ask: "what does the CRM actually look like
 * right now". It is the ingestion mechanism §3.4 deliberately leaves to
 * implementation, and it is additive — no existing reader is touched.
 *
 * WHY NOT `db/today/facts.ts`. That module answers the same question through
 * `scopedLeads(agencyId, plan, scope)`, which filters `whereIn('userId',
 * s.gotPermIds)` for non-admins. It needs a VIEWER. A proactive sweep has no
 * session and no user, and manufacturing one would put `user_perms` logic on a
 * cron path. So detection is scoped to the AGENCY and stops there; who may see
 * a resulting insight is decided later, by the notification worker that already
 * resolves recipients. Detection sees the agency; delivery decides visibility.
 *
 * WHAT IS DELIBERATELY NOT READ. `name` and `phone` are never selected. The
 * classifier does not use them and a signal must not carry customer identity —
 * a subject id and a trace ref are the whole payload. They are returned as null
 * to satisfy `LeadFact`, which is shaped for the Today brief's UI needs.
 *
 * The plan gate mirrors `scopedLeads`: on the free plan, over-quota leads are
 * invisible in the product, so the runtime must not reason about them either.
 *
 * The message aggregation is the SAME shape `candidateFactsQuery` uses (Today
 * Amendment C-2: a human outbound is one whose metadata.source is NOT the
 * auto-response marker), because the classifier this feeds is that classifier.
 * Only the SCOPE differs; no qualifying rule is re-derived here.
 */

function toMs(v: unknown): number | null {
  if (v == null) return null
  const t = (v instanceof Date ? v : new Date(v as string)).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * Every non-terminal lead in the agency, with the facts `classifyLead` needs.
 * Builder only — no execution, so it is SQL-testable via `.toSQL()`.
 */
export function agencyLeadFactsQuery(agencyId: number, plan: string) {
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

  const q = db('clients').where('clients.agencyId', agencyId).where('clients.lead', true)
  if (plan === 'free') q.where('clients.overQuota', false)

  return q
    .whereNotIn('clients.status', [...TERMINAL_STATUSES])
    .leftJoin(db.raw('(?) as msg', [msg]), 'msg.lead_id', 'clients.id')
    .select(
      'clients.id',
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

/** Execute the agency-scoped facts read. The agency comes from the scope, never a request. */
export async function listAgencyLeadFacts(scope: Scope): Promise<LeadFact[]> {
  const plan = await getEffectiveLeadPlan(scope.agencyId)
  const rows = (await agencyLeadFactsQuery(scope.agencyId, plan)) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: Number(r.id),
    name: null,
    phone: null,
    status: (r.status as string | null) ?? null,
    leadSource: (r.leadSource as string | null) ?? null,
    createdAt: toMs(r.createdAt),
    nextFollowUpAt: toMs(r.nextFollowUpAt),
    lastActivityAt: toMs(r.lastActivityAt),
    lastInboundAt: toMs(r.lastInboundAt),
    lastHumanOutboundAt: toMs(r.lastHumanOutboundAt),
    hasOpenTask: Boolean(r.hasOpenTask),
    earliestOpenTaskDueAt: toMs(r.earliestOpenTaskDueAt),
  }))
}

/**
 * ONE lead's facts, by subject id — the additive read Phase 4.2's precondition
 * re-check needs.
 *
 * `listAgencyLeadFacts` answers "what does the whole agency look like", which is
 * the right question for a detection sweep and the wrong one immediately before
 * an investigation: by then exactly one subject matters, and reading every lead
 * to find it would put an agency-sized scan on the critical path of a single job.
 *
 * It reuses `agencyLeadFactsQuery` UNCHANGED and adds one predicate, so every
 * qualifying rule — the terminal-status exclusion, the free-plan over-quota gate,
 * the Amendment C-2 human-outbound aggregation — stays defined in exactly one
 * place. Nothing here re-derives a fact.
 *
 * Returns null when the lead is not in this agency, is terminal, or is invisible
 * under the plan — all of which mean the same thing to the caller: there is
 * nothing here to investigate.
 */
export async function readLeadFact(scope: Scope, leadId: number): Promise<LeadFact | null> {
  const plan = await getEffectiveLeadPlan(scope.agencyId)
  const rows = (await agencyLeadFactsQuery(scope.agencyId, plan).where('clients.id', leadId)) as Record<string, unknown>[]
  const r = rows[0]
  if (!r) return null
  return {
    id: Number(r.id),
    name: null,
    phone: null,
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
