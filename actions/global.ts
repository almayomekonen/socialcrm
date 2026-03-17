'use server'

import { getUser } from '@/db/auth'
import { db } from '@/config/db'

export async function saveTblPref(tblId, columns) {
  const user = await getUser()

  await db('users')
    .where({ id: user.id })
    .update({
      tblPref: db.raw(`jsonb_set(COALESCE("tblPref", '{}'::jsonb), ?, ?)`, [`{${tblId}}`, JSON.stringify(columns)]),
    })
}
