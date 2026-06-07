'use server'

import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'
import { daysFromNow } from '@/lib/dates'
import { scheduleLeadIntelWarm } from '@/lib/ai/scheduleWarm'
import { resolveOutcome, isLeadOutcome, type LeadOutcome } from '@/lib/leads/outcomeRules'

/**
 * Inline Outcome Logging — Stage 1 action.
 *
 * Records a post-call disposition in one fast write: stamps lastOutcomeType +
 * lastActivityAt, progresses status per resolveOutcome (the outcome is the
 * source of truth for progression), and sets/clears the next follow-up. Reuses
 * the same field semantics as recordLeadActivity / setLeadFollowUp / updateLead,
 * combined into a single scoped update to avoid triple round-trips and a double
 * lastActivityAt write. Agency- and permission-scoped exactly like updateLead.
 */

export type LogLeadOutcomeInput = {
  id: number
  outcome: LeadOutcome
  /** Optional override for the next follow-up date; if omitted, the outcome's default (in days) is used. */
  followUpAt?: string | Date | null
  /** Optional one-line note for the follow-up (only applied when a follow-up is set). */
  note?: string | null
}

export type LogLeadOutcomeResult = { err: true; msg: string } | Record<string, unknown>

export async function logLeadOutcome(input: LogLeadOutcomeInput): Promise<LogLeadOutcomeResult> {
  const id = Number(input?.id)
  if (!Number.isFinite(id) || id <= 0) return { err: true, msg: 'ליד לא תקין' }
  if (!isLeadOutcome(input?.outcome)) return { err: true, msg: 'תוצאה לא תקינה' }

  const user = await requireUser()
  const { gotPermIds } = await getPerms(user)

  // Read current status (scoped) to resolve the transition; absence = not found / no permission.
  const readQuery = db('clients').where({ id, agencyId: user.agencyId })
  if (!isAdmin(user.role)) readQuery.whereIn('userId', gotPermIds)
  const lead = await readQuery.first('status')
  if (!lead) return { err: true, msg: 'הליד לא נמצא' }

  const res = resolveOutcome(input.outcome, lead.status ?? null)
  const now = new Date()

  const patch: Record<string, unknown> = {
    lastOutcomeType: res.code,
    lastActivityAt: now,
    updatedAt: now,
  }
  if (res.nextStatus) {
    patch.status = res.nextStatus
    patch.statusChangedAt = now
  }
  if (res.followUp.kind === 'clear') {
    patch.nextFollowUpAt = null
    patch.followUpNote = null
  } else if (res.followUp.kind === 'in_days') {
    const at = input.followUpAt ? new Date(input.followUpAt) : daysFromNow(res.followUp.days)
    if (isNaN(at.getTime())) return { err: true, msg: 'תאריך לא תקין' }
    patch.nextFollowUpAt = at
    // Only overwrite the note when one is explicitly provided; otherwise preserve existing context.
    if (input.note !== undefined) patch.followUpNote = input.note?.trim() || null
  }

  const writeQuery = db('clients').where({ id, agencyId: user.agencyId })
  if (!isAdmin(user.role)) writeQuery.whereIn('userId', gotPermIds)
  const rows = await writeQuery.update(patch).returning('*')
  if (!rows || rows.length === 0) return { err: true, msg: 'הליד לא נמצא' }

  revalidatePath('/leads')
  revalidatePath('/dashboard')
  revalidatePath(`/clients/${id}`)

  // An outcome mutates status + lastOutcomeType — the exact fields AI summaries
  // ingest — so refresh the warm cache, matching updateLead. (Reuses the
  // existing 'lead.update' reason; an outcome is a form of lead update.)
  scheduleLeadIntelWarm(id, { reason: 'lead.update' })
  return rows[0]
}
