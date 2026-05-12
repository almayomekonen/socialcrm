import { db } from '@/config/db'
import { getFullLead, getFamMembers } from './clients'
import { get5TasksByClientId } from './tasks'
import { getUserNameById } from './usersNTeams'

const STAGNATION_BANDS = {
  fresh: 2, // days in current status <= 2
  active: 7,
  slow: 14,
  stale: 30,
  // > 30 -> 'cold'
} as const

export type PipelineStagnation = 'fresh' | 'active' | 'slow' | 'stale' | 'cold'
export type InactivityRisk = 'low' | 'medium' | 'high'

export type LeadIntelligenceInputs = {
  // Core identity / config (carried over)
  status: string | null
  leadSource: string | null
  rank: number | null
  hasHandler: boolean
  handlerName: string | null
  gender: string | null
  familyStatus: string | null
  ageYears: number | null
  hasEmail: boolean
  hasPhone: boolean
  familyMemberCount: number
  detailsExcerpt: string | null

  // Behavioural signals (new tight set)
  leadAgeDays: number | null
  daysSinceLastInteraction: number | null
  daysInCurrentStatus: number | null
  lastOutcomeType: string | null
  daysSinceLastTask: number | null
  daysSinceLastCompletedTask: number | null
  taskCompletionRate: number | null
  overdueTaskCount: number
  pipelineStagnation: PipelineStagnation
  inactivityRisk: InactivityRisk

  // Recent task list (kept for context; titles only)
  recentTasks: { title: string; status: string | null; daysOld: number | null }[]

  // Cache key signal
  updatedAtIso: string | null
}

const DETAILS_EXCERPT_MAX = 400

function daysBetween(a: Date | string | null | undefined, b: Date | string): number | null {
  if (!a) return null
  const ta = typeof a === 'string' ? Date.parse(a) : a.getTime()
  const tb = typeof b === 'string' ? Date.parse(b) : b.getTime()
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null
  return Math.max(0, Math.round((tb - ta) / (1000 * 60 * 60 * 24)))
}

function ageYears(birthDate: Date | string | null | undefined): number | null {
  if (!birthDate) return null
  const t = typeof birthDate === 'string' ? Date.parse(birthDate) : birthDate.getTime()
  if (!Number.isFinite(t)) return null
  const ms = Date.now() - t
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24 * 365.25)))
}

export type LeadTaskStats = {
  taskCount: number
  completedCount: number
  overdueCount: number
  lastCreatedAt: string | null
  lastCompletedAt: string | null
  lastTitle: string | null
  lastStatus: string | null
}

export async function getLeadTaskStats(leadId: number): Promise<LeadTaskStats> {
  // Single aggregate. tasks.clientId is indexed.
  const row = await db.raw(
    `
    SELECT
      COUNT(*)::int                                                                    AS "taskCount",
      COUNT(*) FILTER (WHERE completed = true)::int                                     AS "completedCount",
      COUNT(*) FILTER (WHERE completed = false AND "dueDate" IS NOT NULL AND "dueDate" < CURRENT_DATE)::int AS "overdueCount",
      MAX("createdAt")                                                                 AS "lastCreatedAt",
      MAX("updatedAt") FILTER (WHERE completed = true)                                  AS "lastCompletedAt"
    FROM tasks
    WHERE "clientId" = ?
    `,
    [leadId],
  )

  const agg = row.rows?.[0] ?? {
    taskCount: 0,
    completedCount: 0,
    overdueCount: 0,
    lastCreatedAt: null,
    lastCompletedAt: null,
  }

  // Last task title/status — second cheap lookup (1 row).
  const last =
    agg.taskCount > 0
      ? await db('tasks').where('clientId', leadId).orderBy('createdAt', 'desc').select('title', 'status').first()
      : null

  return {
    taskCount: agg.taskCount ?? 0,
    completedCount: agg.completedCount ?? 0,
    overdueCount: agg.overdueCount ?? 0,
    lastCreatedAt: agg.lastCreatedAt ? new Date(agg.lastCreatedAt).toISOString() : null,
    lastCompletedAt: agg.lastCompletedAt ? new Date(agg.lastCompletedAt).toISOString() : null,
    lastTitle: last?.title ?? null,
    lastStatus: last?.status ?? null,
  }
}

export function derivePipelineStagnation(
  daysInCurrentStatus: number | null,
  daysSinceLastInteraction: number | null,
): PipelineStagnation {
  // Use whichever signal is fresher; if both null, treat as 'cold' (we have no engagement evidence).
  const candidates = [daysInCurrentStatus, daysSinceLastInteraction].filter((v): v is number => typeof v === 'number')
  if (candidates.length === 0) return 'cold'
  const d = Math.min(...candidates)
  if (d <= STAGNATION_BANDS.fresh) return 'fresh'
  if (d <= STAGNATION_BANDS.active) return 'active'
  if (d <= STAGNATION_BANDS.slow) return 'slow'
  if (d <= STAGNATION_BANDS.stale) return 'stale'
  return 'cold'
}

export function deriveInactivityRisk(
  daysSinceLastInteraction: number | null,
  overdueTaskCount: number,
  stagnation: PipelineStagnation,
): InactivityRisk {
  // High: cold OR many overdue OR very long silence
  if (stagnation === 'cold' || overdueTaskCount >= 2) return 'high'
  if (
    stagnation === 'stale' ||
    overdueTaskCount === 1 ||
    (typeof daysSinceLastInteraction === 'number' && daysSinceLastInteraction >= 14)
  ) {
    return 'medium'
  }
  return 'low'
}

export async function getLeadIntelligenceInputs(
  leadId: number,
): Promise<{ inputs: LeadIntelligenceInputs; updatedAtIso: string | null } | null> {
  const lead = await getFullLead({
    id: leadId,
    select: [
      'status',
      'leadSource',
      'rank',
      'createdAt',
      'updatedAt',
      'statusChangedAt',
      'handlerId',
      'gender',
      'familyStatus',
      'birthDate',
      'email',
      'phone',
      'details',
      'lastActivityAt',
      'lastOutcomeType',
    ],
  })
  if (!lead) return null

  const [handlerName, fam, tasks, taskStats] = await Promise.all([
    lead.handlerId ? getUserNameById(lead.handlerId) : Promise.resolve(null),
    getFamMembers(leadId).then((r) => r.famMembers),
    get5TasksByClientId(leadId),
    getLeadTaskStats(leadId),
  ])

  const now = new Date()
  const detailsExcerpt =
    typeof lead.details === 'string' && lead.details.trim().length > 0 ? lead.details.trim().slice(0, DETAILS_EXCERPT_MAX) : null

  const updatedAtIso = lead.updatedAt ? new Date(lead.updatedAt as Date | string).toISOString() : null

  const leadAgeDays = daysBetween(lead.createdAt as Date | string | null, now)
  const daysSinceLastInteraction = daysBetween(lead.lastActivityAt as Date | string | null, now)
  const daysInCurrentStatus = daysBetween(lead.statusChangedAt as Date | string | null, now)
  const daysSinceLastTask = daysBetween(taskStats.lastCreatedAt, now)
  const daysSinceLastCompletedTask = daysBetween(taskStats.lastCompletedAt, now)

  const taskCompletionRate = taskStats.taskCount > 0 ? Number((taskStats.completedCount / taskStats.taskCount).toFixed(2)) : null

  const pipelineStagnation = derivePipelineStagnation(daysInCurrentStatus, daysSinceLastInteraction)
  const inactivityRisk = deriveInactivityRisk(daysSinceLastInteraction, taskStats.overdueCount, pipelineStagnation)

  const inputs: LeadIntelligenceInputs = {
    status: lead.status ?? null,
    leadSource: lead.leadSource ?? null,
    rank: typeof lead.rank === 'number' ? lead.rank : null,
    hasHandler: Boolean(lead.handlerId),
    handlerName: handlerName ?? null,
    gender: lead.gender ?? null,
    familyStatus: lead.familyStatus ?? null,
    ageYears: ageYears(lead.birthDate as Date | string | null),
    hasEmail: Boolean(lead.email),
    hasPhone: Boolean(lead.phone),
    familyMemberCount: Array.isArray(fam) ? fam.length : 0,
    detailsExcerpt,

    leadAgeDays,
    daysSinceLastInteraction,
    daysInCurrentStatus,
    lastOutcomeType: (lead.lastOutcomeType as string | null) ?? null,
    daysSinceLastTask,
    daysSinceLastCompletedTask,
    taskCompletionRate,
    overdueTaskCount: taskStats.overdueCount,
    pipelineStagnation,
    inactivityRisk,

    recentTasks: (tasks ?? []).map((t: any) => ({
      title: typeof t.title === 'string' ? t.title.slice(0, 200) : '',
      status: t.status ?? null,
      daysOld: daysBetween(t.createdAt as Date | string | null, now),
    })),
    updatedAtIso,
  }

  return { inputs, updatedAtIso }
}
