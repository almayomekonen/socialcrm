import { db } from '@/config/db'
import type { FollowUpSignals } from '@/lib/ai/followUpRules'

export async function getLeadFollowUpSignals(leadIds: number[]): Promise<Map<number, FollowUpSignals>> {
  const out = new Map<number, FollowUpSignals>()
  if (!leadIds.length) return out

  const res = await db.raw(
    `
    WITH task_stats AS (
      SELECT
        "clientId",
        COUNT(*) FILTER (
          WHERE completed = false
            AND "dueDate" IS NOT NULL
            AND "dueDate" < CURRENT_DATE
        )::int AS "overdueTaskCount",
        COUNT(*) FILTER (
          WHERE completed = false
            AND "dueDate" = CURRENT_DATE
        )::int AS "dueTodayTaskCount",
        COUNT(*) FILTER (WHERE completed = false)::int AS "openTaskCount",
        COUNT(*)::int                                  AS "taskCount",
        COUNT(*) FILTER (WHERE completed = true)::int  AS "completedCount"
      FROM tasks
      WHERE "clientId" = ANY(?)
      GROUP BY "clientId"
    )
    SELECT
      c.id,
      c.status,
      c."statusChangedAt",
      c."lastActivityAt",
      COALESCE(t."overdueTaskCount",  0)::int AS "overdueTaskCount",
      COALESCE(t."dueTodayTaskCount", 0)::int AS "dueTodayTaskCount",
      COALESCE(t."openTaskCount",     0)::int AS "openTaskCount",
      COALESCE(t."taskCount",         0)::int AS "taskCount",
      COALESCE(t."completedCount",    0)::int AS "completedCount"
    FROM clients c
    LEFT JOIN task_stats t ON t."clientId" = c.id
    WHERE c.id = ANY(?)
    `,
    [leadIds, leadIds],
  )

  const now = Date.now()
  for (const r of res.rows ?? []) {
    out.set(r.id, {
      status: r.status ?? null,
      daysSinceLastInteraction: daysBetween(r.lastActivityAt, now),
      daysInCurrentStatus: daysBetween(r.statusChangedAt, now),
      overdueTaskCount: r.overdueTaskCount,
      dueTodayTaskCount: r.dueTodayTaskCount,
      openTaskCount: r.openTaskCount,
      taskCompletionRate: r.taskCount > 0 ? Number((r.completedCount / r.taskCount).toFixed(2)) : null,
    })
  }

  return out
}

function daysBetween(from: Date | string | null | undefined, nowMs: number): number | null {
  if (!from) return null
  const t = typeof from === 'string' ? Date.parse(from) : from.getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.round((nowMs - t) / (1000 * 60 * 60 * 24)))
}
