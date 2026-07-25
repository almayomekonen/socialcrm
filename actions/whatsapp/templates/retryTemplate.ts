'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { loadTemplateForMutation, archiveTemplateRow } from '@/db/whatsappTemplates'
import { createTemplate, type CreateTemplateResult } from './createTemplate'
import type { TemplateInput } from '@/lib/whatsapp/templates/types'

/**
 * Retry a rejected ready-made message (RFC §3): create a NEW template from the
 * (edited) input and archive the old rejected one. Immutability is preserved —
 * the rejected row is never mutated. Admin-only, agency-scoped, server-enforced;
 * the new create reuses createTemplate (so validation, throttle, Graph, and token
 * confinement all apply).
 */

const PERM_ERROR = 'אין הרשאה לנהל הודעות מוכנות.'
const NOT_RETRIABLE = 'לא נמצאה הודעה שנדחתה לנסות מחדש.'

export async function retryTemplate(rejectedId: number, input: TemplateInput): Promise<CreateTemplateResult> {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return { ok: false, error: PERM_ERROR }

  const old = await loadTemplateForMutation(rejectedId, user.agencyId)
  if (!old || old.status !== 'rejected') return { ok: false, error: NOT_RETRIABLE }

  const res = await createTemplate(input)
  if (!res.ok) return res // nothing archived — the rejected row stays for another try

  await archiveTemplateRow(rejectedId, user.agencyId)
  return res
}
