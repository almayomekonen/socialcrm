'use server'

import { db } from '@/config/db'
import { getAgencyId } from '@/db/agencies'
import { revalidatePath } from 'next/cache'

export async function upsertPromo(promo, id) {
  let res = null as any
  id
    ? (res = await db('promo').update(promo).where({ id }))
    : (res = await db('promo').insert({ ...promo, agencyId: await getAgencyId() }))

  revalidatePath('/')
}

export async function deletePromo(id) {
  await db('promo').delete().where({ id })
  revalidatePath('/')
}
