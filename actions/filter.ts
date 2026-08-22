'use server'

import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { requireBasicCrmAccess } from '@/lib/requireUser'

/**
 * Saved filters are the user's own view preferences, stored on their own row.
 * Search, filter and sort stay available after a subscription lapses — they
 * spend nothing, and taking them away would make the customer's remaining data
 * harder to read for no reason. Scoped to `user.id` exactly as before.
 */

export async function addSavedFilters({ data }: { data: { name: string; href: string }; id?: number }) {
  const user = await requireBasicCrmAccess()
  await db('users')
    .where({ id: user.id })
    .update({
      savedFilters: db.raw('jsonb_insert("savedFilters", \'{0}\', ?::jsonb, true)', [JSON.stringify(data)]),
    })

  revalidatePath('/deals')
}

export async function updateSavedFilters({ data }: { data: { name: string; href: string }; id?: number }) {
  const user = await requireBasicCrmAccess()
  await db('users')
    .where({ id: user.id })
    .update({
      savedFilters: JSON.stringify(data),
    })

  revalidatePath('/deals')
}
