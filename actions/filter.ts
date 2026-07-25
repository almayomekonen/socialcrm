'use server'

import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { requireProductAccess } from '@/lib/requireUser'

export async function addSavedFilters({ data }: { data: { name: string; href: string }; id?: number }) {
  const user = await requireProductAccess()
  await db('users')
    .where({ id: user.id })
    .update({
      savedFilters: db.raw('jsonb_insert("savedFilters", \'{0}\', ?::jsonb, true)', [JSON.stringify(data)]),
    })

  revalidatePath('/deals')
}

export async function updateSavedFilters({ data }: { data: { name: string; href: string }; id?: number }) {
  const user = await requireProductAccess()
  await db('users')
    .where({ id: user.id })
    .update({
      savedFilters: JSON.stringify(data),
    })

  revalidatePath('/deals')
}
