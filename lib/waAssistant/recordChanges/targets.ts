import 'server-only'
import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import type { AgentScope } from '@/lib/agent/types'

/**
 * The existing records a change may apply to. The same bounds the executors
 * enforce: a task through its lead's agency and the rep's visibility; a meeting
 * in the agency, for this lead, organized by this user, still ahead.
 */

const LIMIT = 20

export type TaskTarget = { id: number; title: string; dueDate: string | null }
export type MeetingTarget = { id: number; title: string; startAt: Date; endAt: Date; hasGoogleEvent: boolean }

export async function openTasksForLead(scope: AgentScope, clientId: number): Promise<TaskTarget[]> {
  const q = db('tasks as t')
    .join('clients as c', 'c.id', 't.clientId')
    .where({ 'c.agencyId': scope.agencyId, 't.clientId': clientId })
    .whereRaw('COALESCE(t.completed, false) = false')
    .orderByRaw('t."dueDate" ASC NULLS LAST, t.id ASC')
    .limit(LIMIT)
  if (!isAdmin(scope.role)) {
    const perms = scope.gotPermIds ?? []
    q.where((b) => b.whereIn('c.userId', perms).orWhereIn('c.createdById', perms))
  }
  const rows = (await q.select('t.id', 't.title', db.raw(`to_char(t."dueDate", 'YYYY-MM-DD') as "dueDate"`))) as TaskTarget[]
  return rows.map((r) => ({ id: Number(r.id), title: r.title, dueDate: r.dueDate }))
}

export async function upcomingMeetingsForLead(scope: AgentScope, clientId: number, nowMs: number): Promise<MeetingTarget[]> {
  const rows = (await db('meetings')
    .where({ agency_id: scope.agencyId, lead_id: clientId, organizer_user_id: scope.userId, status: 'scheduled' })
    .where('start_at', '>', new Date(nowMs))
    .orderBy('start_at')
    .limit(LIMIT)
    .select('id', 'title', 'start_at', 'end_at', 'google_event_id')) as { id: number; title: string; start_at: Date; end_at: Date; google_event_id: string | null }[]
  return rows.map((r) => ({ id: Number(r.id), title: r.title, startAt: new Date(r.start_at), endAt: new Date(r.end_at), hasGoogleEvent: !!r.google_event_id }))
}
