'use server'

import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { requireProductAccess } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'
import { trackOncePerAgency } from '@/lib/analytics/track'

/**
 * Follow-Up Engine V1 — explicit, snoozable follow-up date per lead.
 *
 * One date + one optional note per lead. Deliberately NOT a task system: setting
 * a follow-up replaces any existing one; clearing removes it. Setting/clearing
 * also stamps lastActivityAt (it's real lead work). No reminders/cron/AI here —
 * those read this column in later stages.
 *
 * Both actions mirror updateLead's auth + permission gate: an agency-scoped
 * write, and for non-admins restricted to leads the user owns (gotPermIds).
 */

export type SetLeadFollowUpInput = {
  id: number
  /** When to follow up — Date or ISO string. */
  at: string | Date
  /** Optional one-line context, e.g. "ביקש לחזור בשבוע הבא". */
  note?: string | null
}

export type FollowUpResult = { err: true; msg: string } | Record<string, unknown>

// Applies an agency- and permission-scoped update to one lead, mirroring
// updateLead's gate. The query is built and executed in one place so we never
// `await` a bare knex builder (which is itself thenable and would execute as a
// stray SELECT, returning rows instead of the builder).
async function applyFollowUp(
  id: number,
  patch: Record<string, unknown>,
  /**
   * Emitted only by the SET path. Clearing a follow-up is not setting one, and
   * counting it would make the activation milestone mean "touched the control".
   */
  marksFirstFollowUp = false,
): Promise<FollowUpResult> {
  const user = await requireProductAccess()
  const { gotPermIds } = await getPerms(user)
  const query = db('clients').where({ id, agencyId: user.agencyId })
  if (!isAdmin(user.role)) query.whereIn('userId', gotPermIds)

  const res = await query.update(patch).returning('*')
  if (!res || res.length === 0) return { err: true, msg: 'הליד לא נמצא' }

  /**
   * THE ACTIVATION MILESTONE — emitted here, and only here.
   *
   * It previously came from `FirstLeadCallout`, a client component rendered by
   * the desktop lead-summary route alone, gated behind a `?firstLead=1` arrival
   * param and a module-level latch that had to survive a router refresh. In the
   * whole history of production it fired zero times: agencies 119 and 135
   * created their first lead on a phone, where that component does not exist,
   * so the loop could not complete on the surface most signups arrive from.
   *
   * `setLeadFollowUp` is the ONE action both the desktop `FollowUpControl` and
   * the mobile `LeadFollowUpSheet` already call, so emitting here makes the
   * event surface-agnostic and impossible to reach without a real, persisted,
   * permission-checked write — this line sits AFTER the update returned a row.
   *
   * `trackOncePerAgency` gives the idempotency: the first successful follow-up
   * for the agency, never repeated saves. Inside `after()` so the existence
   * check never adds latency to the user's save.
   */
  if (marksFirstFollowUp) {
    after(() => trackOncePerAgency(user.agencyId, 'first_follow_up_set', user.id))
  }

  revalidatePath('/leads')
  revalidatePath('/dashboard')
  revalidatePath(`/clients/${id}`)
  return res[0]
}

export async function setLeadFollowUp(input: SetLeadFollowUpInput): Promise<FollowUpResult> {
  const id = Number(input?.id)
  if (!Number.isFinite(id) || id <= 0) return { err: true, msg: 'ליד לא תקין' }

  const at = input.at instanceof Date ? input.at : new Date(input.at)
  if (isNaN(at.getTime())) return { err: true, msg: 'תאריך לא תקין' }

  const now = new Date()
  return applyFollowUp(
    id,
    {
      nextFollowUpAt: at,
      followUpNote: input.note?.trim() || null,
      lastActivityAt: now,
      updatedAt: now,
    },
    true,
  )
}

export async function clearLeadFollowUp(input: { id: number }): Promise<FollowUpResult> {
  const id = Number(input?.id)
  if (!Number.isFinite(id) || id <= 0) return { err: true, msg: 'ליד לא תקין' }

  const now = new Date()
  return applyFollowUp(id, {
    nextFollowUpAt: null,
    followUpNote: null,
    lastActivityAt: now,
    updatedAt: now,
  })
}
