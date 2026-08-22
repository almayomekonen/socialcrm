'use server'

import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { requireBasicCrmAccess } from '@/lib/requireUser'

/**
 * TIER 1. A table's column layout is the user's own view preference, written to
 * their own row. It consumes no quota, calls no provider, sends nothing and
 * touches no commission data.
 *
 * It was Pro gated, and six tables call it with no catch, so an expired
 * customer reordering a column on the Leads page was answered by the segment
 * error boundary with "חלה שגיאה במערכת". Scoping is unchanged: the update is
 * still keyed on the session user's own id.
 */
export async function saveTblPref(tblId, columns) {
  await requireBasicCrmAccess()
  const user = await getUser()

  await db('users')
    .where({ id: user.id })
    .update({
      tblPref: db.raw(`jsonb_set(COALESCE("tblPref", '{}'::jsonb), ?, ?)`, [`{${tblId}}`, JSON.stringify(columns)]),
    })
}
