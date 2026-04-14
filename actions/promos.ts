'use server'

import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/requireUser'

export async function upsertPromo(promo, id) {
  const user = await requireUser()
  let res = null as any
  id
    ? (res = await db('promo').update(promo).where({ id, agencyId: user.agencyId }))
    : (res = await db('promo').insert({ ...promo, agencyId: user.agencyId }))

  revalidatePath('/deals')
}

export async function deletePromo(id) {
  const user = await requireUser()
  await db('promo').where({ id, agencyId: user.agencyId }).delete()
  revalidatePath('/deals')
}
