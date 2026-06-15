import { db } from '@/config/db'
import { getAgencyId } from '@/db/agencies'
import { getAgencyPlan } from '@/lib/quota'
import { isAdmin, Roles } from '@/types/roles'
import { BRIEFING_SAMPLE_LIMIT, STALE_DAYS, WEEK_START_SQL } from '@/lib/copilot/general/constants'

// Exported so the Q&A action reuses the EXACT same scope shape (no casts).
export type Scope = { user: { role: Roles }; gotPermIds: number[] }

export type BriefingLeadRow = { id: number; name: string | null; status: string | null }

/**
 * Every list reader returns a TRUE total plus a hard-capped sample. The total
 * comes from a `COUNT(*) OVER()` window (evaluated before LIMIT), so the
 * headline number is never under-reported even though we cap the rows we ship.
 */
export type BriefingLeadList = { total: number; sample: BriefingLeadRow[] }

type Row = BriefingLeadRow & { total: number }

/**
 * Scoped lead query — the single permission gate. Non-admins are constrained to
 * `gotPermIds`; the free plan hides over-quota leads. Identical to the existing
 * `getNewLeads` / `hasAnyLeads` pattern; adds NO new join logic.
 *
 * Exported so the catastrophic-risk control can be asserted at the SQL level
 * without a live DB (see __tests__/ai/briefing-scope.test.ts).
 */
export function scopedLeads(agencyId: number, plan: string, s: Scope) {
  const q = db('clients').where('agencyId', agencyId).where('lead', true)
  if (!isAdmin(s.user.role)) q.whereIn('userId', s.gotPermIds)
  if (plan === 'free') q.where('overQuota', false)
  return q
}

function toList(rows: Row[]): BriefingLeadList {
  const total = rows.length ? Number(rows[0].total) : 0
  return { total, sample: rows.map((r) => ({ id: r.id, name: r.name, status: r.status })) }
}

/** Leads whose nextFollowUpAt falls within today (not closed/lost). */
export async function getFollowUpsDueToday(s: Scope): Promise<BriefingLeadList> {
  const agencyId = await getAgencyId()
  const plan = await getAgencyPlan(agencyId)
  const rows: Row[] = await scopedLeads(agencyId, plan, s)
    .whereNotNull('nextFollowUpAt')
    .whereRaw(`"nextFollowUpAt" >= date_trunc('day', NOW())`)
    .whereRaw(`"nextFollowUpAt" < date_trunc('day', NOW()) + INTERVAL '1 day'`)
    .whereNotIn('status', ['closed', 'lost'])
    .select('id', 'name', 'status', db.raw('COUNT(*) OVER()::int as total'))
    .orderBy('nextFollowUpAt', 'asc')
    .limit(BRIEFING_SAMPLE_LIMIT)
  return toList(rows)
}

/** Leads not contacted in >= STALE_DAYS (by lastActivityAt), still active. */
export async function getLeadsNotContactedRecently(s: Scope): Promise<BriefingLeadList> {
  const agencyId = await getAgencyId()
  const plan = await getAgencyPlan(agencyId)
  const rows: Row[] = await scopedLeads(agencyId, plan, s)
    .whereNotIn('status', ['closed', 'lost'])
    .whereRaw(`("lastActivityAt" IS NULL OR "lastActivityAt" < NOW() - make_interval(days => ?))`, [STALE_DAYS])
    .select('id', 'name', 'status', db.raw('COUNT(*) OVER()::int as total'))
    .orderByRaw(`"lastActivityAt" ASC NULLS FIRST`)
    .limit(BRIEFING_SAMPLE_LIMIT)
  return toList(rows)
}

/** Leads created since Sunday 00:00. */
export async function getNewLeadsThisWeek(s: Scope): Promise<BriefingLeadList> {
  const agencyId = await getAgencyId()
  const plan = await getAgencyPlan(agencyId)
  const rows: Row[] = await scopedLeads(agencyId, plan, s)
    .whereRaw(`"createdAt" >= ${WEEK_START_SQL}`)
    .select('id', 'name', 'status', db.raw('COUNT(*) OVER()::int as total'))
    .orderBy('createdAt', 'desc')
    .limit(BRIEFING_SAMPLE_LIMIT)
  return toList(rows)
}

/** Open overdue tasks across the user's leads: true count + capped lead sample. */
export async function getOverdueTaskSummary(s: Scope): Promise<BriefingLeadList> {
  const agencyId = await getAgencyId()
  const plan = await getAgencyPlan(agencyId)
  const sub = scopedLeads(agencyId, plan, s).select('id')
  const rows: Row[] = await db('tasks as t')
    .join('clients as c', 'c.id', 't.clientId')
    .whereIn('t.clientId', sub)
    .where('t.completed', false)
    .whereRaw(`t."dueDate" < CURRENT_DATE`)
    .select('c.id', 'c.name', 'c.status', db.raw('COUNT(*) OVER()::int as total'))
    .orderByRaw(`t."dueDate" ASC`)
    .limit(BRIEFING_SAMPLE_LIMIT)
  return toList(rows)
}

/** Unread inbound conversations across the user's leads (inbound only). Scalars. */
export async function getUnreadInboxSummary(s: Scope): Promise<{ conversations: number; unread: number }> {
  const agencyId = await getAgencyId()
  const plan = await getAgencyPlan(agencyId)
  const sub = scopedLeads(agencyId, plan, s).select('id')
  const row = (await db('inbox_conversations')
    .where('agencyId', agencyId)
    .whereIn('leadId', sub)
    .where('unreadCount', '>', 0)
    .select(db.raw('COUNT(*)::int as conversations'), db.raw('COALESCE(SUM("unreadCount"),0)::int as unread'))
    .first()) as { conversations?: number; unread?: number } | undefined
  return { conversations: Number(row?.conversations ?? 0), unread: Number(row?.unread ?? 0) }
}
