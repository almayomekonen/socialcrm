'use server'

import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'

export async function addSavedFilters({ data, id }: { data: { name: string; href: string }; id: number }) {
  const res = await db('users')
    .where({ id })
    .update({
      savedFilters: db.raw('jsonb_insert("savedFilters", \'{0}\', ?::jsonb, true)', [JSON.stringify(data)]),
    })

  revalidatePath('/')
}

export async function updateSavedFilters({ data, id }: { data: { name: string; href: string }; id: number }) {
  await db('users')
    .where({ id })
    .update({
      savedFilters: JSON.stringify(data),
    })

  revalidatePath('/')
}
