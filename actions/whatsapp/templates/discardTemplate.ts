'use server'

import { db } from '@/config/db'
import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { loadTemplateForMutation, discardTemplateRow } from '@/db/whatsappTemplates'
import { deleteTemplateOnMeta } from '@/lib/whatsapp/templates/graph'
import type { MutateTemplateResult } from './archiveTemplate'

/**
 * Discard a never-used (pending/rejected) ready-made message: delete it from Meta
 * (freeing the WABA's template slot) AND remove the local row (RFC §4). Approved
 * templates cannot be discarded — they are archived. Admin-only, agency-scoped,
 * server-enforced. The token never leaves the server; Meta errors mapped to Hebrew.
 */

const PERM_ERROR = 'אין הרשאה לנהל הודעות מוכנות.'
const NOT_FOUND = 'ההודעה לא נמצאה.'
const USE_ARCHIVE = 'הודעה מאושרת — אפשר להעביר לארכיון, לא להסיר.'

export async function discardTemplate(id: number): Promise<MutateTemplateResult> {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return { ok: false, error: PERM_ERROR }

  const row = await loadTemplateForMutation(id, user.agencyId)
  if (!row) return { ok: false, error: NOT_FOUND }
  if (row.status !== 'pending' && row.status !== 'rejected') return { ok: false, error: USE_ARCHIVE }

  // Delete from Meta first (best-effort resolution of the agency's token). If the
  // Meta delete fails, keep the local row so the user can retry — do not orphan.
  const conn = await db('whatsapp_connections').where({ agency_id: user.agencyId }).first('waba_id', 'access_token')
  if (row.metaTemplateId && conn?.waba_id && conn?.access_token) {
    const del = await deleteTemplateOnMeta(conn.waba_id, conn.access_token, row.name)
    if (!del.ok) return { ok: false, error: 'error' in del ? del.error : NOT_FOUND }
  }

  await discardTemplateRow(id, user.agencyId)
  return { ok: true }
}
