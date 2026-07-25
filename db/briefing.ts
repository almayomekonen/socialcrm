import { db } from '@/config/db'
import { getAgencyId } from '@/db/agencies'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { isAdmin, Roles } from '@/types/roles'
import { BRIEFING_SAMPLE_LIMIT, STALE_DAYS, WEEK_START_SQL } from '@/lib/copilot/general/constants'

export type Scope = { user: { role: Roles }; gotPermIds: number[] }

export type BriefingLeadRow = {
  id: number
  name: string | null
  status: string | null
  ageDays?: number | null
  waitingDays?: number | null
  freshnessDays?: number | null
}

export type BriefingLeadList = { total: number; sample: BriefingLeadRow[] }

type Row = BriefingLeadRow & { total: number }

export function scopedLeads(agencyId: number, plan: string, s: Scope) {
  const q = db('clients').where('agencyId', agencyId).where('lead', true)
  if (!isAdmin(s.user.role)) q.whereIn('userId', s.gotPermIds)
  if (plan === 'free') q.where('overQuota', false)
  return q
}

export type NamedLead = { id: number; name: string; status: string | null; nextFollowUpAt: string | null }

export async function getLeadsByName(s: Scope, name: string): Promise<NamedLead[]> {
  const terms = name.trim().split(/\s+/).filter(Boolean).slice(0, 3)
  if (terms.length === 0) return []
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)
  const q = scopedLeads(agencyId, plan, s)
  for (const term of terms) {
    q.where((b) => b.where('firstName', 'ilike', `%${term}%`).orWhere('lastName', 'ilike', `%${term}%`))
  }
  const rows = await q.select('id', 'firstName', 'lastName', 'status', 'nextFollowUpAt').limit(10)
  return rows.map(
    (r: { id: number; firstName: string | null; lastName: string | null; status: string | null; nextFollowUpAt: unknown }) => ({
      id: Number(r.id),
      name: [r.firstName, r.lastName].filter(Boolean).join(' ') || 'ליד ללא שם',
      status: r.status ?? null,
      nextFollowUpAt:
        r.nextFollowUpAt instanceof Date ? r.nextFollowUpAt.toISOString() : r.nextFollowUpAt ? String(r.nextFollowUpAt) : null,
    }),
  )
}

export async function getNamedLeadById(s: Scope, id: number): Promise<NamedLead | null> {
  if (!Number.isFinite(id) || id <= 0) return null
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)
  const r = await scopedLeads(agencyId, plan, s).where('id', id).first('id', 'firstName', 'lastName', 'status', 'nextFollowUpAt')
  if (!r) return null
  return {
    id: Number(r.id),
    name: [r.firstName, r.lastName].filter(Boolean).join(' ') || 'ליד ללא שם',
    status: r.status ?? null,
    nextFollowUpAt:
      r.nextFollowUpAt instanceof Date ? r.nextFollowUpAt.toISOString() : r.nextFollowUpAt ? String(r.nextFollowUpAt) : null,
  }
}

function toList(rows: Row[]): BriefingLeadList {
  const total = rows.length ? Number(rows[0].total) : 0
  return {
    total,
    sample: rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      ageDays: r.ageDays == null ? null : Number(r.ageDays),
      waitingDays: r.waitingDays == null ? null : Number(r.waitingDays),
      freshnessDays: r.freshnessDays == null ? null : Number(r.freshnessDays),
    })),
  }
}

export async function getFollowUpsDueToday(s: Scope): Promise<BriefingLeadList> {
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)
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

export async function getLeadsNotContactedRecently(s: Scope): Promise<BriefingLeadList> {
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)
  const rows: Row[] = await scopedLeads(agencyId, plan, s)
    .whereNotIn('status', ['closed', 'lost'])
    .whereRaw(`("lastActivityAt" IS NULL OR "lastActivityAt" < NOW() - make_interval(days => ?))`, [STALE_DAYS])
    .select(
      'id',
      'name',
      'status',
      db.raw('COUNT(*) OVER()::int as total'),
      db.raw('(CURRENT_DATE - "lastActivityAt"::date)::int as "ageDays"'), // days since last contact; NULL if never contacted
    )
    .orderByRaw(`"lastActivityAt" ASC NULLS FIRST`)
    .limit(BRIEFING_SAMPLE_LIMIT)
  return toList(rows)
}

export async function getNewLeadsThisWeek(s: Scope): Promise<BriefingLeadList> {
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)
  const rows: Row[] = await scopedLeads(agencyId, plan, s)
    .whereRaw(`"createdAt" >= ${WEEK_START_SQL}`)
    .select(
      'id',
      'name',
      'status',
      db.raw('COUNT(*) OVER()::int as total'),
      db.raw('(CURRENT_DATE - "createdAt"::date)::int as "freshnessDays"'), // days since the lead was created
    )
    .orderBy('createdAt', 'desc')
    .limit(BRIEFING_SAMPLE_LIMIT)
  return toList(rows)
}

export async function getOverdueTaskSummary(s: Scope): Promise<BriefingLeadList> {
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)
  const sub = scopedLeads(agencyId, plan, s).select('id')
  const rows: Row[] = await db('tasks as t')
    .join('clients as c', 'c.id', 't.clientId')
    .whereIn('t.clientId', sub)
    .where('t.completed', false)
    .whereRaw(`t."dueDate" < CURRENT_DATE`)
    .select(
      'c.id',
      'c.name',
      'c.status',
      db.raw('COUNT(*) OVER()::int as total'),
      db.raw('(CURRENT_DATE - t."dueDate"::date)::int as "ageDays"'), // days the task is overdue
    )
    .orderByRaw(`t."dueDate" ASC`)
    .limit(BRIEFING_SAMPLE_LIMIT)
  return toList(rows)
}

export const PROMISED_WAITING_RECENCY_DAYS = 14

export function promisedButWaitingQuery(agencyId: number, plan: string, s: Scope) {
  const msg = db('inbox_messages as m')
    .join('inbox_conversations as cv', 'cv.id', 'm.conversationId')
    .where('m.agencyId', agencyId)
    .where('m.channel', 'whatsapp')
    .groupBy('cv.leadId')
    .select(
      'cv.leadId as lead_id',
      db.raw(`MAX(COALESCE(m."channelTimestamp", m."createdAt")) FILTER (WHERE m.direction = 'inbound')  AS last_inbound_at`),
      db.raw(`MAX(COALESCE(m."channelTimestamp", m."createdAt")) FILTER (WHERE m.direction = 'outbound') AS last_outbound_at`),
    )

  return scopedLeads(agencyId, plan, s)
    .join(db.raw('(?) as msg', [msg]), 'msg.lead_id', 'clients.id')
    .whereNotIn('clients.status', ['closed', 'lost'])
    .whereNotNull('clients.nextFollowUpAt')
    .whereRaw(`clients."nextFollowUpAt" < NOW()`)
    .whereRaw(`msg.last_inbound_at > clients."nextFollowUpAt"`)
    .whereRaw(`(msg.last_outbound_at IS NULL OR msg.last_outbound_at < msg.last_inbound_at)`)
    .whereRaw(`msg.last_inbound_at > NOW() - make_interval(days => ?)`, [PROMISED_WAITING_RECENCY_DAYS])
    .select(
      'clients.id',
      'clients.name',
      'clients.status',
      db.raw('COUNT(*) OVER()::int as total'),
      db.raw('(CURRENT_DATE - msg.last_inbound_at::date)::int as "waitingDays"'), // days since the customer's last inbound
    )
    .orderByRaw(`msg.last_inbound_at ASC`)
    .limit(BRIEFING_SAMPLE_LIMIT)
}

export async function getPromisedButWaiting(s: Scope): Promise<BriefingLeadList> {
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)
  const rows = (await promisedButWaitingQuery(agencyId, plan, s)) as Row[]
  return toList(rows)
}

export async function getUnreadInboxSummary(s: Scope): Promise<{ conversations: number; unread: number }> {
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)
  const sub = scopedLeads(agencyId, plan, s).select('id')
  const row = (await db('inbox_conversations')
    .where('agencyId', agencyId)
    .whereIn('leadId', sub)
    .where('unreadCount', '>', 0)
    .select(db.raw('COUNT(*)::int as conversations'), db.raw('COALESCE(SUM("unreadCount"),0)::int as unread'))
    .first()) as { conversations?: number; unread?: number } | undefined
  return { conversations: Number(row?.conversations ?? 0), unread: Number(row?.unread ?? 0) }
}
