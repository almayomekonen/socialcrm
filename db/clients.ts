import { db } from '@/config/db'
import { isAdmin, type Roles } from '@/types/roles'
import { getAgencyId } from './agencies'
import { getPerms } from './filter'
import { applyDueMembership } from './worklist'
import { filesJsonAgg } from './helpers/aggregations'
import { Lead, LeadInfo } from '@/types/db/tables'
import { requireUser } from '@/lib/requireUser'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { parseListId } from '@/lib/leads/leadScope'

/** Whitespace-separated terms honoured in one search. See the matcher below. */
const MAX_SEARCH_TERMS = 6

export type LeadKey = keyof Lead | keyof LeadInfo

export async function getFullLead({ id, select }: { id: number; select?: LeadKey[] }) {
  const user = await requireUser()
  let query = db('clients as c').join('clients_info as ci', 'c.id', 'ci.id').where('c.id', id).where('c.agencyId', user.agencyId)

  const columnsToSelect = select ? select.filter((col) => col !== 'idFiles') : ['c.*', 'ci.*']

  query.select(columnsToSelect)

  if (select?.includes('idFiles')) {
    query
      .leftJoin('files as f', db.raw('f.id = ANY(ci."idFiles")'))
      .select(
        db.raw(`
       ${filesJsonAgg} AS "idFiles"
      `),
      )
      .groupBy('c.id', 'ci.id')
  }

  const lead = await query.first()

  return lead ? { ...lead, id: id } : undefined
}

export async function recordLeadActivity(
  leadId: number,
  agencyId: number,
  opts?: { outcomeType?: string | null; at?: Date },
): Promise<void> {
  const at = opts?.at ?? new Date()
  const patch: Record<string, unknown> = { lastActivityAt: at, updatedAt: at }
  if (opts && 'outcomeType' in opts) patch.lastOutcomeType = opts.outcomeType ?? null
  await db('clients').where({ id: leadId, agencyId }).update(patch)
}

export async function getFamMembers(clientId) {
  const user = await requireUser()
  const familyId = (await db('clients').where({ id: clientId, agencyId: user.agencyId }).select('familyId').first())?.familyId
  if (!familyId) return { famMembers: [], familyId: null }

  const famMembers = await db('clients')
    .where({ familyId, agencyId: user.agencyId })
    .select('id', 'name', 'idNum', 'birthDate', 'gender', 'familyStatus', 'phone', 'email', 'familyId')

  return { famMembers, familyId }
}

export async function hasAnyLeads(agencyId: number, gotPermIds: number[], role: Roles): Promise<boolean> {
  const plan = await getEffectiveLeadPlan(agencyId)
  const q = db('clients').where({ agencyId })

  if (!isAdmin(role)) q.whereIn('userId', gotPermIds)
  if (plan === 'free') q.where('overQuota', false)
  const res = await q.count('id').first()
  return Number(res?.count || 0) > 0
}

export async function getTrialPreviewLeads(
  agencyId: number,
  gotPermIds: number[],
  role: Roles,
): Promise<{ total: number; names: string[] }> {
  // Same permission scoping as hasAnyLeads: reps only ever see their own leads,
  // and free agencies hide over-quota leads. The paywall must not leak names.
  const plan = await getEffectiveLeadPlan(agencyId)
  const q = db('clients').where({ agencyId, lead: true })
  if (!isAdmin(role)) q.whereIn('userId', gotPermIds)
  if (plan === 'free') q.where('overQuota', false)

  const rows = await q
    .orderBy('updatedAt', 'desc')
    .limit(6)
    .select('name', 'firstName', 'lastName', db.raw('COUNT(*) OVER()::int as total'))

  const total = rows.length ? Number(rows[0].total) : 0
  const names = rows.map((r: any) => [r.firstName, r.lastName].filter(Boolean).join(' ') || r.name || 'ליד').filter(Boolean)

  return { total, names }
}

export async function getLeadsByRep(user) {
  const authedUser = await requireUser()
  const { gotPermIds } = await getPerms(user)

  const plan = await getEffectiveLeadPlan(authedUser.agencyId)
  const q = db('clients').select('id', 'details').where({ agencyId: authedUser.agencyId }).whereIn('userId', gotPermIds)
  if (plan === 'free') q.where('overQuota', false)

  return await q
}

export async function getLeadLists(userId) {
  return await db('client_lists').where({ userId })
}

export async function getGlobalMaxLeadId(): Promise<number> {
  const agencyId = await getAgencyId()
  const result = await db('clients').where({ agencyId, lead: true }).max('id as maxId').first()
  return Number(result?.maxId ?? 0)
}

export async function getGlobalLatestUpdatedAt(): Promise<string> {
  const agencyId = await getAgencyId()
  const result = await db('clients').where({ agencyId, lead: true }).max('updatedAt as maxUpdatedAt').first()
  return result?.maxUpdatedAt ? new Date(result.maxUpdatedAt).toISOString() : new Date(0).toISOString()
}

/**
 * Server-side filters for the lead list — now BOTH presentations.
 *
 * Still passed as an EXPLICIT argument, never read out of `params` here. The
 * original note said desktop must not consume `q` because a mobile-shared URL
 * would then "silently" change what a desktop user sees — a behaviour change
 * "smuggled in through a URL". That was a blast-radius guard for a flag-gated
 * mobile rollout, and its load-bearing word was *silently*.
 *
 * Desktop now opts in DELIBERATELY (see the two list pages), and the workspace
 * renders a visible, clearable active-search indicator whenever `q` is applied.
 * A shared `/leads?q=…` is no longer a silent narrowing; it is a shared filtered
 * view that announces itself — which is what a URL-backed filter is supposed to
 * be. The guard is retired on purpose, not by accident.
 *
 * Callers pass ONLY what their surface can communicate: the desktop pages pass
 * `q` and not `status`, because desktop has no status-filter chrome to explain
 * a status narrowing.
 */
export type LeadListFilters = { q?: string; status?: string[] }

export async function getLeadsTable({
  user,
  params,
  leads = false,
  gotPermIds,
  settings = null,
  filters = null,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any
  leads?: boolean
  gotPermIds?: number[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings?: any
  filters?: LeadListFilters | null
}) {
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)

  let { listId, pageNum, tableLimit } = params
  pageNum = Number(pageNum) || 1
  tableLimit = Number(tableLimit) || 100

  const base = db('clients')
    .where('clients.agencyId', agencyId)
    .where('lead', leads)
    .leftJoin({ handler: 'users' }, 'clients.handlerId', 'handler.id')
    .leftJoin({ creator: 'users' }, 'clients.userId', 'creator.id')
    .select(
      'clients.*',
      'handler.name as handlerName',
      'creator.name as userName',
      db.raw(`EXTRACT(EPOCH FROM (NOW() - clients."statusChangedAt")) / 3600.0 AS elapsed_hours`),
      db.raw(
        `CASE clients.status WHEN 'new' THEN 2.0 WHEN 'contacted' THEN 24.0 WHEN 'interested' THEN 72.0 ELSE NULL END AS sla_hours`,
      ),
    )

  if (gotPermIds && !isAdmin(user.role)) base.whereIn('clients.userId', gotPermIds)
  if (plan === 'free') base.where('clients.overQuota', false)

  if (params.view === 'due') applyDueMembership(base)

  /**
   * Mobile filters. Applied to `base`, i.e. BEFORE the priority/SLA CTE, so the
   * computed ordering is over the filtered set rather than a filtered slice of a
   * pre-ordered page. Both branches are no-ops when `filters` is absent.
   *
   * `status` is already validated against the fixed vocabulary by
   * `parseLeadFilters`; the `IN` binding is parameterised regardless.
   */
  if (filters?.status?.length) base.whereIn('clients.status', filters.status)

  if (filters?.q) {
    /**
     * TERM-SPLIT SEARCH — the table now matches the way the autocomplete does.
     *
     * One un-split `%q%` used to be tested against each column, so "ספי ברהנה"
     * only hit a row whose `name` held that exact string, and "ברהנה ספי" hit
     * nothing at all — while the autocomplete, which splits on whitespace and
     * ANDs the terms, cheerfully suggested the lead. The dropdown and the table
     * could disagree about the same query, which is the one thing a search must
     * never do.
     *
     * Every term must match somewhere (AND across terms, OR across fields), so
     * word order stops mattering. `whereILike` parameterises each value and the
     * wildcards are ours — a user's `%` or `_` is matched literally after
     * escaping, so searching "50%" cannot become a full-scan pattern.
     *
     * Terms are capped as well as `q`'s length: each one adds a five-column OR
     * group, and no name search needs more than this.
     */
    const terms = filters.q.split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TERMS)
    for (const rawTerm of terms) {
      const term = `%${rawTerm.replace(/[\\%_]/g, (c) => '\\' + c)}%`
      base.where((b) => {
        b.whereILike('clients.name', term)
          .orWhereILike('clients.phone', term)
          .orWhereILike('clients.email', term)
          .orWhereILike('clients.firstName', term)
          .orWhereILike('clients.lastName', term)
      })
    }
  }

  /**
   * Saved lists belong to a user, and `client_lists` carries no agencyId of
   * its own — so the ownership check is a join to `users`. Without it any id
   * read another agency's list and used its `clientIds`; the rows stayed
   * agency-scoped by `base`, so nothing leaked, but an unknown id also meant
   * `list.clientIds` on `undefined` — a TypeError that took the page down
   * from a querystring. A list we cannot resolve is treated as absent; an
   * empty list correctly matches nothing.
   */
  const listIdNum = parseListId(listId)
  if (listIdNum !== null) {
    const list = await db('client_lists as cl')
      .join('users as u', 'cl.userId', 'u.id')
      .where('cl.id', listIdNum)
      .where('u.agencyId', agencyId)
      .first('cl.clientIds')
    if (list) base.whereIn('clients.id', list.clientIds ?? [])
  }

  const limit = tableLimit
  const offset = (pageNum - 1) * tableLimit

  if (settings) {
    const coldMonths = Number(settings.monthsLidimSheloHufku) || 8
    const stuckMonths = Number(settings.monthsUpdated) || 24
    base.select(
      db.raw(`CASE WHEN ? AND clients."updatedAt" < NOW() - (? * INTERVAL '1 month') THEN true ELSE false END AS is_cold`, [
        !!settings.isRiskUpdated,
        coldMonths,
      ]),
      db.raw(`CASE WHEN ? AND clients."updatedAt" < NOW() - (? * INTERVAL '1 month') THEN true ELSE false END AS is_stuck`, [
        !!settings.isMahalotKashotUpdated,
        stuckMonths,
      ]),
      db.raw(`CASE WHEN ? AND clients."handlerId" IS NULL THEN true ELSE false END AS is_unassigned`, [
        !!settings.isBituachHaimMutzarHaser,
      ]),
    )
  }

  return db
    .with('with_elapsed', base)
    .with(
      'with_computed',
      db.raw(`
      SELECT
        *,
        CASE
          WHEN sla_hours IS NULL THEN NULL
          WHEN elapsed_hours >= sla_hours THEN elapsed_hours / sla_hours
          ELSE 0
        END AS "overdueRatio",
        CASE
          WHEN status IN ('closed', 'lost') THEN NULL
          WHEN sla_hours IS NULL THEN NULL
          WHEN elapsed_hours >= sla_hours THEN 'cold'
          ELSE 'updated'
        END AS state,
        CASE
          WHEN status IN ('closed', 'lost') OR sla_hours IS NULL OR elapsed_hours < sla_hours THEN NULL
          WHEN elapsed_hours / sla_hours < 2 THEN 1
          WHEN elapsed_hours / sla_hours < 4 THEN 2
          ELSE 3
        END AS severity,
        CASE
          WHEN sla_hours IS NULL THEN NULL
          WHEN elapsed_hours >= sla_hours THEN 0
          ELSE sla_hours - elapsed_hours
        END AS "slaRemainingHours",
        CASE WHEN status = 'new' AND elapsed_hours < 2 THEN true ELSE false END AS "isNewBadge",
        CASE status
          WHEN 'new' THEN 'התקשר עכשיו'
          WHEN 'contacted' THEN 'עקוב אחרי'
          WHEN 'interested' THEN 'סגור עסקה'
          ELSE NULL
        END AS "nextAction",
        CASE
          WHEN status IN ('closed', 'lost') THEN 0
          WHEN elapsed_hours / NULLIF(sla_hours, 0) > 3 THEN
            200 + CASE status WHEN 'new' THEN 40 WHEN 'contacted' THEN 30 WHEN 'interested' THEN 20 ELSE 0 END
          ELSE
            CASE status WHEN 'new' THEN 40 WHEN 'contacted' THEN 30 WHEN 'interested' THEN 20 ELSE 0 END
            + LEAST(COALESCE(elapsed_hours / NULLIF(sla_hours, 0), 0), 5)
              * CASE status WHEN 'new' THEN 10 WHEN 'contacted' THEN 5 WHEN 'interested' THEN 3 ELSE 0 END
        END AS priority
      FROM with_elapsed
    `),
    )
    .select('*')
    .from('with_computed')
    .orderByRaw('priority DESC, "statusChangedAt" DESC')
    .limit(limit)
    .offset(offset)
}

export type LeadColumnAvailability = {
  idNum: boolean
  secPhone: boolean
  birthDate: boolean
  gender: boolean
}

export async function getLeadColumnAvailability({
  user,
  leads,
  gotPermIds,
}: {
  user: { role: Roles }
  leads: boolean
  gotPermIds?: number[]
}): Promise<LeadColumnAvailability> {
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)

  const base = db('clients').where('agencyId', agencyId).where('lead', leads)
  if (gotPermIds && !isAdmin(user.role)) base.whereIn('userId', gotPermIds)
  if (plan === 'free') base.where('overQuota', false)

  const row = await base
    .select(
      db.raw(`COALESCE(bool_or("idNum" ~ '[^[:space:]]'), false) AS "idNum"`),
      db.raw(`COALESCE(bool_or("secPhone" ~ '[^[:space:]]'), false) AS "secPhone"`),
      // Date column: NULL is the only empty state. Never trim a date.
      db.raw(`COALESCE(bool_or("birthDate" IS NOT NULL), false) AS "birthDate"`),
      // gender is a Postgres enum (gender_enum) — it can only be a defined label or NULL,
      // never '' or whitespace, so IS NOT NULL already means "meaningful value".
      db.raw(`COALESCE(bool_or(gender IS NOT NULL), false) AS gender`),
    )
    .first()

  return {
    idNum: !!row?.idNum,
    secPhone: !!row?.secPhone,
    birthDate: !!row?.birthDate,
    gender: !!row?.gender,
  }
}

export async function getLeadNameByIdNum(idNum) {
  const agencyId = await getAgencyId()
  const res = await db('clients').where('idNum', idNum).where('agencyId', agencyId).select('name').first()
  return res?.name
}
