'use server'

import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { requireProductAccess } from '@/lib/requireUser'

export async function saveTblPref(tblId, columns) {
  await requireProductAccess()
  const user = await getUser()

  await db('users')
    .where({ id: user.id })
    .update({
      tblPref: db.raw(`jsonb_set(COALESCE("tblPref", '{}'::jsonb), ?, ?)`, [`{${tblId}}`, JSON.stringify(columns)]),
    })
}
