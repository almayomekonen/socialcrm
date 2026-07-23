'use server'

import { requireAgencyUser } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { loadTemplateForMutation, archiveTemplateRow } from '@/db/whatsappTemplates'

/**
 * Archive an approved (Meta-retained) ready-made message: hide it locally
 * (`archivedAt`), leave the Meta template intact (RFC §4 — approved templates are
 * NEVER deleted). Admin-only, agency-scoped, server-enforced.
 */
export type MutateTemplateResult = { ok: true } | { ok: false; error: string }

const PERM_ERROR = 'אין הרשאה לנהל הודעות מוכנות.'
const NOT_FOUND = 'ההודעה לא נמצאה.'
const USE_DISCARD = 'הודעה שממתינה לבדיקה או שנדחתה — יש להסיר, לא להעביר לארכיון.'

export async function archiveTemplate(id: number): Promise<MutateTemplateResult> {
  const user = await requireAgencyUser()
  if (!isAdmin(user.role)) return { ok: false, error: PERM_ERROR }

  const row = await loadTemplateForMutation(id, user.agencyId)
  if (!row) return { ok: false, error: NOT_FOUND }
  // Archive is for Meta-retained statuses (approved/paused/disabled); never-used
  // templates (pending/rejected) are discarded instead.
  if (row.status === 'pending' || row.status === 'rejected') return { ok: false, error: USE_DISCARD }

  await archiveTemplateRow(id, user.agencyId)
  return { ok: true }
}
